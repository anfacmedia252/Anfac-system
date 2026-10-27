const express = require('express');
const path = require('path');
const crypto = require('crypto');
const { getPool, initializeDatabase } = require('./database');

const app = express();
const PORT = process.env.PORT || 5000;
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const scrypt = (password, salt) => crypto.scryptSync(password, salt, 64).toString('hex');

app.use(express.json({ limit: '15mb' }));
app.use(express.static(path.join(__dirname, 'public')));

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  return `${salt}:${scrypt(password, salt)}`;
}

function verifyPassword(password, storedHash) {
  const [salt, hash] = String(storedHash || '').split(':');
  if (!salt || !hash || !/^[a-f0-9]{128}$/i.test(hash)) return false;
  const actual = Buffer.from(scrypt(password, salt), 'hex');
  const expected = Buffer.from(hash, 'hex');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function asyncRoute(handler) {
  return (request, response, next) => {
    initializeDatabase()
      .then(() => handler(request, response, next))
      .catch(next);
  };
}

function cookieValue(request, name) {
  const cookies = (request.headers.cookie || '').split(';');
  const cookie = cookies.map(part => part.trim()).find(part => part.startsWith(`${name}=`));
  return cookie ? decodeURIComponent(cookie.slice(name.length + 1)) : '';
}

function setSessionCookie(response, token) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  response.setHeader('Set-Cookie', `anfac_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_TTL_MS / 1000}${secure}`);
}

function clearSessionCookie(response) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  response.setHeader('Set-Cookie', `anfac_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`);
}

async function getAuthenticatedUser(request, response) {
  const token = cookieValue(request, 'anfac_session');
  if (!token) {
    response.status(401).json({ error: 'Sign in is required.' });
    return null;
  }
  const result = await getPool().query(`
    SELECT u.id, u.username, u.role, u.staff_id, u.client_id, u.approved, u.display_name, u.email
    FROM app_sessions s
    JOIN app_users u ON u.id = s.user_id
    WHERE s.token_hash = $1 AND s.expires_at > NOW() AND u.approved = TRUE
      AND (u.role <> 'client' OR u.client_id IS NOT NULL)
  `, [crypto.createHash('sha256').update(token).digest('hex')]);
  const session = result.rows[0];
  if (!session) {
    clearSessionCookie(response);
    response.status(401).json({ error: 'Your session has expired. Please sign in again.' });
    return null;
  }
  return {
    id: session.id,
    username: session.username,
    role: session.role,
    staffId: session.staff_id,
    clientId: session.client_id,
    displayName: session.display_name,
    email: session.email
  };
}

async function authenticate(request, response, next) {
  request.user = await getAuthenticatedUser(request, response);
  if (request.user) next();
}

function requireAdmin(request, response, next) {
  if (request.user.role !== 'admin') {
    return response.status(403).json({ error: 'Administrator access is required.' });
  }
  next();
}

function roleRoute(role, handler) {
  return asyncRoute(async (request, response, next) => {
    const user = await getAuthenticatedUser(request, response);
    if (!user) return;
    if (user.role !== role) {
      return response.status(403).json({ error: `${role === 'client' ? 'Client' : 'Administrator'} access is required.` });
    }
    request.user = user;
    return handler(request, response, next);
  });
}

async function loadSharedState() {
  const result = await getPool().query('SELECT state_json FROM app_state WHERE id = 1');
  return result.rows[0]?.state_json || null;
}

async function updateSharedState(update) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await client.query('SELECT state_json FROM app_state WHERE id = 1 FOR UPDATE');
    if (!result.rows[0]) throw new Error('Shared app data has not been initialized.');
    const state = result.rows[0].state_json;
    const value = await update(state);
    await client.query(`
      UPDATE app_state SET state_json = $1::jsonb, updated_at = CURRENT_TIMESTAMP
      WHERE id = 1
    `, [JSON.stringify(state)]);
    await client.query('COMMIT');
    return value;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function saveSharedState(state) {
  await getPool().query(`
    INSERT INTO app_state (id, state_json, updated_at)
    VALUES (1, $1::jsonb, CURRENT_TIMESTAMP)
    ON CONFLICT (id) DO UPDATE SET
      state_json = EXCLUDED.state_json,
      updated_at = CURRENT_TIMESTAMP
  `, [JSON.stringify(state)]);
}

function publicState(state, user) {
  if (!state) return null;
  if (user.role === 'client') {
    const clients = Array.isArray(state.clients) ? state.clients : [];
    const client = clients.find(record => record?.id === user.clientId);
    if (!client) return null;
    const clientName = String(client.name || '').trim().toLocaleLowerCase();
    const nameMatches = clients.filter(record =>
      record && String(record.name || '').trim().toLocaleLowerCase() === clientName
    ).length;
    const belongsToClient = record => record && (record.clientId === user.clientId ||
      (clientName && !record.clientId && nameMatches === 1 &&
        String(record.client || '').trim().toLocaleLowerCase() === clientName));
    return {
      currentUser: {
        role: user.role,
        username: user.username,
        clientId: user.clientId,
        displayName: user.displayName,
        email: user.email
      },
      clientProfile: {
        id: client.id,
        name: client.name,
        logo: client.logo || '',
        status: client.status || ''
      },
      companyLogo: state.companyLogo || '',
      projects: (Array.isArray(state.projects) ? state.projects : []).filter(belongsToClient),
      campaigns: (Array.isArray(state.campaigns) ? state.campaigns : []).filter(belongsToClient),
      bookings: (Array.isArray(state.bookings) ? state.bookings : []).filter(belongsToClient),
      clientRequests: (Array.isArray(state.clientRequests) ? state.clientRequests : [])
        .filter(request => request?.clientId === user.clientId)
    };
  }
  const safeState = { ...state };
  delete safeState.adminAuth;
  safeState.currentUser = { role: user.role, username: user.username, staffId: user.staffId };
  safeState.staff = (safeState.staff || []).map(({ password, ...staff }) => staff);

  if (user.role === 'staff') {
    const staff = safeState.staff.find(member => member.id === user.staffId);
    safeState.transactions = [];
    safeState.campaigns = [];
    safeState.clients = [];
    safeState.projects = [];
    safeState.bookings = [];
    safeState.equipment = (safeState.equipment || []).filter(item => item.staff_taken === staff?.name);
    safeState.staff = staff ? [staff] : [];
    safeState.staffReports = (safeState.staffReports || []).filter(report => report.staffId === user.staffId);
    safeState.profile = staff ? {
      firstName: staff.name,
      lastName: '',
      email: '',
      role: staff.role,
      photo: staff.photo || ''
    } : {};
  }
  return safeState;
}

app.post('/api/auth/login', asyncRoute(async (request, response) => {
  const username = typeof request.body.username === 'string' ? request.body.username.trim() : '';
  const password = typeof request.body.password === 'string' ? request.body.password : '';
  if (!username || !password || username.length > 100 || password.length > 256) {
    return response.status(400).json({ error: 'Enter a valid username and password.' });
  }

  const result = await getPool().query('SELECT * FROM app_users WHERE username = $1', [username]);
  const account = result.rows[0];
  if (!account || !verifyPassword(password, account.password_hash)) {
    return response.status(401).json({ error: 'Invalid username or password.' });
  }
  if (!account.approved) {
    return response.status(403).json({ error: 'Your client account is awaiting administrator approval.' });
  }
  if (account.role === 'client' && !account.client_id) {
    return response.status(403).json({ error: 'Your client account must be linked to an existing client profile before you can sign in.' });
  }

  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  await getPool().query('DELETE FROM app_sessions WHERE expires_at <= NOW()');
  await getPool().query(
    'INSERT INTO app_sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)',
    [tokenHash, account.id, expiresAt]
  );
  setSessionCookie(response, token);
  response.json({
    user: {
      role: account.role,
      username: account.username,
      staffId: account.staff_id,
      clientId: account.client_id,
      displayName: account.display_name,
      email: account.email
    }
  });
}));

app.post('/api/auth/client-signup', asyncRoute(async (request, response) => {
  const displayName = typeof request.body.displayName === 'string' ? request.body.displayName.trim() : '';
  const email = typeof request.body.email === 'string' ? request.body.email.trim().toLowerCase() : '';
  const username = typeof request.body.username === 'string' ? request.body.username.trim().toLowerCase() : '';
  const password = typeof request.body.password === 'string' ? request.body.password : '';
  if (!displayName || displayName.length > 120 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 ||
      !/^[a-z0-9._-]{3,100}$/.test(username) ||
      password.length < 8 || password.length > 256) {
    return response.status(400).json({
      error: 'Enter your name, a valid email, a username (3–100 letters, numbers, dots, underscores or hyphens), and a password of at least 8 characters.'
    });
  }

  try {
    const result = await getPool().query(`
      INSERT INTO app_users (username, password_hash, role, approved, display_name, email)
      VALUES ($1, $2, 'client', FALSE, $3, $4)
      RETURNING id
    `, [username, hashPassword(password), displayName, email]);
    response.status(201).json({
      success: true,
      message: 'Your account request was submitted. An administrator must link it to your client profile before you can sign in.',
      id: result.rows[0].id
    });
  } catch (error) {
    if (error.code === '23505') {
      return response.status(409).json({ error: 'That username is already in use.' });
    }
    throw error;
  }
}));

app.post('/api/auth/logout', asyncRoute(async (request, response) => {
  const token = cookieValue(request, 'anfac_session');
  if (token) {
    await getPool().query('DELETE FROM app_sessions WHERE token_hash = $1', [
      crypto.createHash('sha256').update(token).digest('hex')
    ]);
  }
  clearSessionCookie(response);
  response.json({ success: true });
}));

app.get('/api/auth/session', asyncRoute(async (request, response) => {
  const user = await getAuthenticatedUser(request, response);
  if (user) response.json({ user });
}));

app.put('/api/client/profile', roleRoute('client', async (request, response) => {
  const displayName = typeof request.body.displayName === 'string' ? request.body.displayName.trim() : '';
  const email = typeof request.body.email === 'string' ? request.body.email.trim().toLowerCase() : '';
  const username = typeof request.body.username === 'string' ? request.body.username.trim().toLowerCase() : '';
  const currentPassword = typeof request.body.currentPassword === 'string' ? request.body.currentPassword : '';
  const newPassword = typeof request.body.newPassword === 'string' ? request.body.newPassword : '';
  if (!displayName || displayName.length > 120 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 ||
      !/^[a-z0-9._-]{3,100}$/.test(username) ||
      (newPassword && (newPassword.length < 8 || newPassword.length > 256))) {
    return response.status(400).json({ error: 'Enter a valid name, email, username, and password (at least 8 characters).' });
  }
  const accountResult = await getPool().query(
    "SELECT password_hash FROM app_users WHERE id = $1 AND role = 'client' AND approved = TRUE",
    [request.user.id]
  );
  const account = accountResult.rows[0];
  if (!account || !verifyPassword(currentPassword, account.password_hash)) {
    return response.status(401).json({ error: 'Enter your current password to save account changes.' });
  }

  try {
    const updated = await getPool().query(`
      UPDATE app_users
      SET display_name = $1, email = $2, username = $3,
          password_hash = CASE WHEN $4 = '' THEN password_hash ELSE $5 END
      WHERE id = $6 AND role = 'client' AND approved = TRUE
      RETURNING username, display_name, email, client_id
    `, [displayName, email, username, newPassword, newPassword ? hashPassword(newPassword) : '', request.user.id]);
    const user = updated.rows[0];
    if (!user) return response.status(401).json({ error: 'Client account is no longer available.' });
    response.json({
      success: true,
      user: {
        role: 'client',
        username: user.username,
        displayName: user.display_name,
        email: user.email,
        clientId: user.client_id
      }
    });
  } catch (error) {
    if (error.code === '23505') {
      return response.status(409).json({ error: 'That username is already in use.' });
    }
    throw error;
  }
}));

app.post('/api/client/bookings', roleRoute('client', async (request, response) => {
  const title = typeof request.body.title === 'string' ? request.body.title.trim() : '';
  const datetime = typeof request.body.datetime === 'string' ? request.body.datetime.trim() : '';
  const match = datetime.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!title || title.length > 200 || !match) {
    return response.status(400).json({ error: 'Enter a session name and a valid booking date and time.' });
  }
  const [, year, month, day, hour, minute] = match.map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 ||
      date.getUTCDate() !== day || date.getUTCHours() !== hour || date.getUTCMinutes() !== minute) {
    return response.status(400).json({ error: 'Enter a valid booking date and time.' });
  }

  let booking;
  try {
    booking = await updateSharedState(state => {
      const clients = Array.isArray(state.clients) ? state.clients : [];
      const client = clients.find(record => record.id === request.user.clientId);
      if (!client) {
        const error = new Error('Your client profile is unavailable. Contact the administrator.');
        error.statusCode = 409;
        throw error;
      }
      if (!Array.isArray(state.bookings)) state.bookings = [];
      const newBooking = {
        id: `BK-${crypto.randomUUID()}`,
        title,
        client: client.name,
        clientId: client.id,
        datetime,
        status: 'Pending'
      };
      state.bookings.unshift(newBooking);
      return newBooking;
    });
  } catch (error) {
    if (error.statusCode) return response.status(error.statusCode).json({ error: error.message });
    throw error;
  }
  response.status(201).json({ success: true, booking });
}));

app.post('/api/client/requests', roleRoute('client', async (request, response) => {
  const subject = typeof request.body.subject === 'string' ? request.body.subject.trim() : '';
  const message = typeof request.body.message === 'string' ? request.body.message.trim() : '';
  if (!subject || subject.length > 160 || !message || message.length > 5000) {
    return response.status(400).json({ error: 'Enter a subject and a message of up to 5,000 characters.' });
  }

  let clientRequest;
  try {
    clientRequest = await updateSharedState(state => {
      const client = (Array.isArray(state.clients) ? state.clients : [])
        .find(record => record.id === request.user.clientId);
      if (!client) {
        const error = new Error('Your client profile is unavailable. Contact the administrator.');
        error.statusCode = 409;
        throw error;
      }
      if (!Array.isArray(state.clientRequests)) state.clientRequests = [];
      const newRequest = {
        id: crypto.randomUUID(),
        clientId: client.id,
        clientName: client.name,
        subject,
        message,
        status: 'New',
        createdAt: new Date().toISOString()
      };
      state.clientRequests.unshift(newRequest);
      return newRequest;
    });
  } catch (error) {
    if (error.statusCode) return response.status(error.statusCode).json({ error: error.message });
    throw error;
  }
  response.status(201).json({ success: true, request: clientRequest });
}));

app.get('/api/app-state', asyncRoute(async (request, response) => {
  const user = await getAuthenticatedUser(request, response);
  if (!user) return;
  const state = await loadSharedState();
  if (!state && user.role === 'staff') {
    return response.status(409).json({ error: 'The administrator must sign in once to initialize shared app data.' });
  }
  response.json({ state: publicState(state, user) });
}));

app.post('/api/app-state', asyncRoute(async (request, response) => {
  const user = await getAuthenticatedUser(request, response);
  if (!user) return;
      if (user.role === 'client') {
        return response.status(403).json({ error: 'Client accounts cannot replace shared application data.' });
      }
      const incoming = request.body;
      if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) {
        return response.status(400).json({ error: 'App state must be a JSON object.' });
      }

      if (user.role === 'staff') {
        const state = await loadSharedState();
        const member = state?.staff?.find(staff => staff.id === user.staffId);
        const incomingMember = incoming.staff?.find(staff => staff.id === user.staffId);
        if (!state || !member || !incomingMember) {
          return response.status(409).json({ error: 'Staff account data is unavailable. Ask an administrator to check the account.' });
        }
        if (Array.isArray(incomingMember.dailyTasks) && incomingMember.dailyTasks.length <= 100) {
          member.dailyTasks = incomingMember.dailyTasks
            .filter(task => task && typeof task.title === 'string')
            .map(task => ({ title: task.title.slice(0, 300), done: Boolean(task.done) }));
        }
        if (typeof incomingMember.photo === 'string' && incomingMember.photo.length <= 10_000_000) {
          member.photo = incomingMember.photo;
        }
        const reports = Array.isArray(state.staffReports) ? state.staffReports : [];
        const reportIds = new Set(reports.map(report => report.id));
        (Array.isArray(incoming.staffReports) ? incoming.staffReports : [])
          .filter(report => report && report.staffId === user.staffId && !reportIds.has(report.id))
          .slice(0, 20)
          .forEach(report => reports.unshift({
            id: String(report.id || crypto.randomUUID()),
            staffId: user.staffId,
            staffName: member.name,
            department: member.department,
            role: member.role,
            date: new Date().toISOString().slice(0, 10),
            type: String(report.type || 'Staff Report').slice(0, 100),
            summary: String(report.summary || '').slice(0, 3000),
            rating: String(report.rating || '').slice(0, 100),
            progress: Math.max(0, Math.min(100, Number(report.progress) || 0))
          }));
        state.staffReports = reports;
        await saveSharedState(state);
        return response.json({ state: publicState(state, user) });
      }

      if (!Array.isArray(incoming.staff)) {
        return response.status(400).json({ error: 'App state must include the staff list.' });
      }
      if (incoming.staff.some(member => !member || typeof member !== 'object' || Array.isArray(member))) {
        return response.status(400).json({ error: 'Every staff record must be a JSON object.' });
      }

      const state = { ...incoming };
      delete state.currentUser;
      delete state.adminAuth;
      state.staff = incoming.staff.map(({ password, ...member }) => member);
      const staffIds = new Set();
      const client = await getPool().connect();
      try {
        await client.query('BEGIN');
        const existingStateResult = await client.query(
          'SELECT state_json FROM app_state WHERE id = 1 FOR UPDATE'
        );
        const existingState = existingStateResult.rows[0]?.state_json;
        if (existingState) {
          if (Array.isArray(existingState.clientRequests)) {
            state.clientRequests = existingState.clientRequests;
          }
          const incomingBookings = Array.isArray(state.bookings) ? state.bookings : [];
          const incomingBookingIds = new Set(incomingBookings.map(booking => booking?.id));
          const newClientBookings = (Array.isArray(existingState.bookings) ? existingState.bookings : [])
            .filter(booking => booking?.clientId && !incomingBookingIds.has(booking.id));
          state.bookings = [...incomingBookings, ...newClientBookings];
        }
        for (const member of incoming.staff) {
          if (typeof member.id !== 'string' || !member.id || typeof member.username !== 'string' || !member.username.trim()) {
            throw new Error('Each staff member needs an ID and username.');
          }
          if (staffIds.has(member.id)) throw new Error('Staff IDs must be unique.');
          staffIds.add(member.id);
          const password = typeof member.password === 'string' ? member.password : '';
          const existingResult = await client.query('SELECT id FROM app_users WHERE staff_id = $1', [member.id]);
          const existing = existingResult.rows[0];
          if (!existing && password.length < 8) {
            throw new Error(`Set a password of at least 8 characters for ${member.name || 'each new staff member'}.`);
          }
          await client.query(`
            INSERT INTO app_users (username, password_hash, role, staff_id)
            VALUES ($1, $2, 'staff', $3)
            ON CONFLICT (staff_id) DO UPDATE SET
              username = EXCLUDED.username,
              password_hash = CASE
                WHEN EXCLUDED.password_hash != '' THEN EXCLUDED.password_hash
                ELSE app_users.password_hash
              END
          `, [member.username.trim(), password ? hashPassword(password) : '', member.id]);
        }
        await client.query(
          "DELETE FROM app_users WHERE role = 'staff' AND NOT (staff_id = ANY($1::text[]))",
          [Array.from(staffIds)]
        );
        await client.query(`
          INSERT INTO app_state (id, state_json, updated_at)
          VALUES (1, $1::jsonb, CURRENT_TIMESTAMP)
          ON CONFLICT (id) DO UPDATE SET
            state_json = EXCLUDED.state_json,
            updated_at = CURRENT_TIMESTAMP
        `, [JSON.stringify(state)]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        if (error.code === '23505') {
          return response.status(409).json({ error: 'That username is already in use.' });
        }
        return response.status(400).json({ error: error.message });
      } finally {
        client.release();
      }
      response.json({ state: publicState(state, user) });
}));

app.put('/api/admin/credentials', asyncRoute(async (request, response) => {
    const user = await getAuthenticatedUser(request, response);
    if (!user) return;
    if (user.role !== 'admin') {
    return response.status(403).json({ error: 'Administrator access is required.' });
    }
    const username = typeof request.body.username === 'string' ? request.body.username.trim() : '';
    const password = typeof request.body.password === 'string' ? request.body.password : '';
    if (!username || username.length > 100) {
      return response.status(400).json({ error: 'Enter a valid administrator username.' });
    }
    if (password && password.length < 8) {
      return response.status(400).json({ error: 'Administrator passwords must be at least 8 characters.' });
    }
    try {
      const result = password
        ? await getPool().query(
          'UPDATE app_users SET username = $1, password_hash = $2 WHERE id = $3 AND role = $4 RETURNING id',
          [username, hashPassword(password), user.id, 'admin']
        )
        : await getPool().query(
          'UPDATE app_users SET username = $1 WHERE id = $2 AND role = $3 RETURNING id',
          [username, user.id, 'admin']
        );
      if (!result.rows.length) return response.status(401).json({ error: 'Administrator session is no longer valid.' });
      user.username = username;
      response.json({ user });
    } catch (databaseError) {
      if (databaseError.code === '23505') {
        return response.status(409).json({ error: 'That username is already in use.' });
      }
      throw databaseError;
    }
}));

app.use('/api', asyncRoute(authenticate), (request, response, next) => {
  if (!request.user) return;
  requireAdmin(request, response, next);
});

app.get('/api/admin/client-accounts', asyncRoute(async (request, response) => {
  const result = await getPool().query(`
    SELECT id, username, display_name, email, created_at
    FROM app_users
    WHERE role = 'client' AND approved = FALSE
    ORDER BY created_at ASC
  `);
  response.json(result.rows);
}));

app.post('/api/admin/client-accounts/:id/approve', asyncRoute(async (request, response) => {
  const clientId = typeof request.body.clientId === 'string' ? request.body.clientId.trim() : '';
  if (!clientId) return response.status(400).json({ error: 'Select the existing client profile for this account.' });

  const connection = await getPool().connect();
  try {
    await connection.query('BEGIN');
    const stateResult = await connection.query('SELECT state_json FROM app_state WHERE id = 1 FOR UPDATE');
    const state = stateResult.rows[0]?.state_json;
    if (!state) {
      await connection.query('ROLLBACK');
      return response.status(409).json({ error: 'Initialize the client directory before approving accounts.' });
    }
    const client = (Array.isArray(state.clients) ? state.clients : []).find(record => record.id === clientId);
    if (!client) {
      await connection.query('ROLLBACK');
      return response.status(404).json({ error: 'The selected client profile no longer exists.' });
    }
    const result = await connection.query(`
      UPDATE app_users
      SET client_id = $1, approved = TRUE
      WHERE id = $2 AND role = 'client' AND approved = FALSE
      RETURNING id
    `, [clientId, request.params.id]);
    if (!result.rows.length) {
      await connection.query('ROLLBACK');
      return response.status(404).json({ error: 'Pending client account not found.' });
    }
    await connection.query('COMMIT');
    response.json({ success: true });
  } catch (error) {
    await connection.query('ROLLBACK');
    throw error;
  } finally {
    connection.release();
  }
}));

app.delete('/api/admin/client-accounts/:id', asyncRoute(async (request, response) => {
  const result = await getPool().query(`
    DELETE FROM app_users
    WHERE id = $1 AND role = 'client' AND approved = FALSE
    RETURNING id
  `, [request.params.id]);
  if (!result.rows.length) return response.status(404).json({ error: 'Pending client account not found.' });
  response.json({ success: true });
}));

app.get('/api/admin/client-requests', asyncRoute(async (request, response) => {
  const state = await loadSharedState();
  response.json(Array.isArray(state?.clientRequests) ? state.clientRequests : []);
}));

app.patch('/api/admin/client-requests/:id', asyncRoute(async (request, response) => {
  const status = typeof request.body.status === 'string' ? request.body.status : '';
  if (!['New', 'In Progress', 'Completed'].includes(status)) {
    return response.status(400).json({ error: 'Choose New, In Progress, or Completed.' });
  }
  try {
    await updateSharedState(state => {
      const clientRequest = (Array.isArray(state.clientRequests) ? state.clientRequests : [])
        .find(item => item.id === request.params.id);
      if (!clientRequest) {
        const error = new Error('Client request not found.');
        error.statusCode = 404;
        throw error;
      }
      clientRequest.status = status;
    });
  } catch (error) {
    if (error.statusCode) return response.status(error.statusCode).json({ error: error.message });
    throw error;
  }
  response.json({ success: true });
}));

app.get('/api/transactions', asyncRoute(async (request, response) => {
  const result = await getPool().query('SELECT * FROM transactions ORDER BY date DESC, id DESC');
  response.json(result.rows);
}));

app.post('/api/transactions', asyncRoute(async (request, response) => {
  const { id, date, type, title, category, method, amount } = request.body;
  const newId = id || `TR-${Math.floor(100 + Math.random() * 900)}`;
  const transDate = date || new Date().toISOString().split('T')[0];
  await getPool().query(`
    INSERT INTO transactions (id, date, type, title, category, method, amount)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
  `, [newId, transDate, type, title, category, method, parseFloat(amount)]);
  response.status(201).json({ success: true, id: newId });
}));

app.put('/api/transactions/:id', asyncRoute(async (request, response) => {
  const { type, title, category, method, amount } = request.body;
  await getPool().query(`
    UPDATE transactions SET type = $1, title = $2, category = $3, method = $4, amount = $5
    WHERE id = $6
  `, [type, title, category, method, parseFloat(amount), request.params.id]);
  response.json({ success: true });
}));

app.delete('/api/transactions/:id', asyncRoute(async (request, response) => {
  await getPool().query('DELETE FROM transactions WHERE id = $1', [request.params.id]);
  response.json({ success: true });
}));

app.get('/api/campaigns', asyncRoute(async (request, response) => {
  const result = await getPool().query('SELECT * FROM campaigns ORDER BY id DESC');
  response.json(result.rows);
}));

app.post('/api/campaigns', asyncRoute(async (request, response) => {
  const { name, client, budget, spent, status } = request.body;
  const id = `CMP-${Math.floor(100 + Math.random() * 900)}`;
  await getPool().query(`
    INSERT INTO campaigns (id, name, client, budget, spent, status)
    VALUES ($1, $2, $3, $4, $5, $6)
  `, [id, name, client, parseFloat(budget), parseFloat(spent || 0), status || 'Active']);
  response.status(201).json({ success: true, id });
}));

app.put('/api/campaigns/:id', asyncRoute(async (request, response) => {
  const { name, client, budget, spent, status } = request.body;
  await getPool().query(`
    UPDATE campaigns SET name = $1, client = $2, budget = $3, spent = $4, status = $5
    WHERE id = $6
  `, [name, client, parseFloat(budget), parseFloat(spent || 0), status, request.params.id]);
  response.json({ success: true });
}));

app.delete('/api/campaigns/:id', asyncRoute(async (request, response) => {
  await getPool().query('DELETE FROM campaigns WHERE id = $1', [request.params.id]);
  response.json({ success: true });
}));

app.get('/api/clients', asyncRoute(async (request, response) => {
  const result = await getPool().query('SELECT * FROM clients ORDER BY id DESC');
  response.json(result.rows);
}));

app.post('/api/clients', asyncRoute(async (request, response) => {
  const { name, retainer, status, logo } = request.body;
  const id = `CL-${Math.floor(100 + Math.random() * 900)}`;
  await getPool().query(`
    INSERT INTO clients (id, name, retainer, status, campaigns, logo)
    VALUES ($1, $2, $3, $4, 1, $5)
  `, [id, name, parseFloat(retainer), status, logo || '']);
  response.status(201).json({ success: true, id });
}));

app.put('/api/clients/:id', asyncRoute(async (request, response) => {
  const { name, retainer, status, logo } = request.body;
  await getPool().query(`
    UPDATE clients SET name = $1, retainer = $2, status = $3, logo = $4 WHERE id = $5
  `, [name, parseFloat(retainer), status, logo || '', request.params.id]);
  response.json({ success: true });
}));

app.delete('/api/clients/:id', asyncRoute(async (request, response) => {
  await getPool().query('DELETE FROM clients WHERE id = $1', [request.params.id]);
  response.json({ success: true });
}));

app.get('/api/projects', asyncRoute(async (request, response) => {
  const result = await getPool().query('SELECT * FROM projects ORDER BY id DESC');
  response.json(result.rows);
}));

app.post('/api/projects', asyncRoute(async (request, response) => {
  const { title, client, category, deadline, status } = request.body;
  const id = `PRJ-${Math.floor(100 + Math.random() * 900)}`;
  await getPool().query(`
    INSERT INTO projects (id, title, client, category, deadline, status)
    VALUES ($1, $2, $3, $4, $5, $6)
  `, [id, title, client, category, deadline, status]);
  response.status(201).json({ success: true, id });
}));

app.delete('/api/projects/:id', asyncRoute(async (request, response) => {
  await getPool().query('DELETE FROM projects WHERE id = $1', [request.params.id]);
  response.json({ success: true });
}));

app.get('/api/bookings', asyncRoute(async (request, response) => {
  const result = await getPool().query('SELECT * FROM bookings ORDER BY datetime ASC');
  response.json(result.rows);
}));

app.post('/api/bookings', asyncRoute(async (request, response) => {
  const { title, client, datetime, status } = request.body;
  const id = `BK-${Math.floor(100 + Math.random() * 900)}`;
  await getPool().query(`
    INSERT INTO bookings (id, title, client, datetime, status)
    VALUES ($1, $2, $3, $4, $5)
  `, [id, title, client, datetime, status || 'Confirmed']);
  response.status(201).json({ success: true, id });
}));

app.delete('/api/bookings/:id', asyncRoute(async (request, response) => {
  await getPool().query('DELETE FROM bookings WHERE id = $1', [request.params.id]);
  response.json({ success: true });
}));

app.get('/api/equipment', asyncRoute(async (request, response) => {
  const result = await getPool().query('SELECT * FROM equipment ORDER BY id DESC');
  response.json(result.rows);
}));

app.post('/api/equipment', asyncRoute(async (request, response) => {
  const { name, category, serial_no, status } = request.body;
  const id = `EQ-${Math.floor(100 + Math.random() * 900)}`;
  await getPool().query(`
    INSERT INTO equipment (id, name, category, serial_no, status)
    VALUES ($1, $2, $3, $4, $5)
  `, [id, name, category, serial_no, status || 'Available']);
  response.status(201).json({ success: true, id });
}));

app.delete('/api/equipment/:id', asyncRoute(async (request, response) => {
  await getPool().query('DELETE FROM equipment WHERE id = $1', [request.params.id]);
  response.json({ success: true });
}));

app.get('/api/staff', asyncRoute(async (request, response) => {
  const result = await getPool().query('SELECT * FROM staff ORDER BY id DESC');
  response.json(result.rows);
}));

app.post('/api/staff', asyncRoute(async (request, response) => {
  const { name, department, role, salary } = request.body;
  const id = `ST-${Math.floor(100 + Math.random() * 900)}`;
  await getPool().query(`
    INSERT INTO staff (id, name, department, role, salary)
    VALUES ($1, $2, $3, $4, $5)
  `, [id, name, department, role, parseFloat(salary)]);
  response.status(201).json({ success: true, id });
}));

app.delete('/api/staff/:id', asyncRoute(async (request, response) => {
  await getPool().query('DELETE FROM staff WHERE id = $1', [request.params.id]);
  await getPool().query("DELETE FROM app_users WHERE staff_id = $1 AND role = 'staff'", [request.params.id]);
  response.json({ success: true });
}));

app.get('/api/profile', asyncRoute(async (request, response) => {
  const result = await getPool().query('SELECT * FROM profile WHERE id = 1');
  response.json(result.rows[0] || null);
}));

app.put('/api/profile', asyncRoute(async (request, response) => {
  const { first_name, last_name, email, role, photo } = request.body;
  await getPool().query(`
    UPDATE profile
    SET first_name = COALESCE($1, first_name),
        last_name = COALESCE($2, last_name),
        email = COALESCE($3, email),
        role = COALESCE($4, role),
        photo = COALESCE($5, photo)
    WHERE id = 1
  `, [first_name, last_name, email, role, photo]);
  response.json({ success: true });
}));

app.use((error, request, response, next) => {
  console.error('Request failed:', error);
  if (response.headersSent) return next(error);
  response.status(500).json({ error: 'An unexpected server error occurred.' });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`ANFAC MEDIA SYSTEM listening on port ${PORT}`);
  });
}

module.exports = app;
