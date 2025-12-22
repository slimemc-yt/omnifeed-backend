// server.js - Production Ready Backend for Render.com
const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');
require('dotenv').config();

// --- 1. SETUP FIREBASE ADMIN (Render Compatible) ---
// On Render, we can't easily upload JSON files. We use an Environment Variable instead.
let serviceAccount;

if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  // Production: Parse the JSON string from Environment Variable
  try {
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  } catch (error) {
    console.error("Error parsing FIREBASE_SERVICE_ACCOUNT env var:", error);
  }
} else {
  // Local Development: Fallback to file if env var is missing
  try {
    serviceAccount = require('./serviceAccountKey.json');
  } catch (error) {
    console.error("WARNING: serviceAccountKey.json not found and FIREBASE_SERVICE_ACCOUNT env var not set.");
  }
}

if (serviceAccount) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
} else {
    console.error("CRITICAL ERROR: Firebase Admin not initialized. Missing credentials.");
}

const db = admin.firestore();
const app = express();

// --- CORS CONFIGURATION ---
// Allow requests from your Vercel frontend (and localhost for testing)
// Set FRONTEND_URL in Render to your specific Vercel URL (e.g., https://omnifeed.vercel.app)
const allowedOrigins = [process.env.FRONTEND_URL, 'http://localhost:5173', 'http://localhost:3000'].filter(Boolean);

app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    if (allowedOrigins.indexOf(origin) === -1 && origin !== process.env.FRONTEND_URL) {
       // In strict production, you might want to block unknown origins.
       // For now, we'll log it but maybe allow it or fail.
       // return callback(new Error('The CORS policy for this site does not allow access from the specified Origin.'), false);
       return callback(null, true); // Permissive for initial testing
    }
    return callback(null, true);
  },
  methods: ['GET', 'POST']
}));

app.use(express.json());

// --- 2. AUTH MIDDLEWARE ---
const verifyAuth = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).send('Unauthorized');
  }
  const token = authHeader.split(' ')[1];
  
  try {
    const decodedToken = await admin.auth().verifyIdToken(token);
    req.uid = decodedToken.uid;
    next();
  } catch (e) {
    console.error("Token verification failed:", e);
    return res.status(401).send('Invalid Token');
  }
};

// --- ROUTES ---

// 1. Initiate Connection
app.get('/api/connect/:platform', verifyAuth, (req, res) => {
  const { platform } = req.params;
  const uid = req.uid;

  // Uses the APP_URL set in Render (e.g. https://omnifeed-backend.onrender.com)
  // Fallback to localhost if not set (for local dev)
  const appUrl = process.env.APP_URL || 'http://localhost:3000';
  const callback = `${appUrl}/callback/${platform}?uid=${uid}`;
  let authUrl = '';

  if (platform === 'twitter') {
    // Requires TWITTER_CLIENT_ID in Render Env Vars
    const clientId = process.env.TWITTER_CLIENT_ID || 'MOCK_CLIENT_ID';
    authUrl = `https://twitter.com/i/oauth2/authorize?response_type=code&client_id=${clientId}&redirect_uri=${callback}&scope=tweet.read users.read&state=${uid}`;
  } 
  else {
    // Default fallback for demo / unimplemented platforms
    authUrl = `${appUrl}/callback/${platform}?uid=${uid}&demo=true`;
  }

  res.json({ authUrl });
});

// 2. Callback Handler
app.get('/callback/:platform', async (req, res) => {
  const { code, uid, demo } = req.query;
  const { platform } = req.params;

  try {
    let accessToken = '';

    if (demo === 'true') {
      accessToken = `mock_${platform}_token_${Date.now()}`;
    } else {
      // TODO: Exchange 'code' for 'accessToken' using the specific Platform API here.
      // const response = await axios.post(...)
      // accessToken = response.data.access_token;
      
      // For now, we simulate a token so the flow completes
      accessToken = `simulated_real_token_${Date.now()}`;
    }

    // Save token to Firestore
    await db.collection('artifacts').doc('omnifeed-production')
      .collection('users').doc(uid)
      .collection('tokens').doc(platform)
      .set({ 
        accessToken, 
        updatedAt: admin.firestore.FieldValue.serverTimestamp() 
      });

    // Update UI Status
    await db.collection('artifacts').doc('omnifeed-production')
      .collection('users').doc(uid)
      .collection('connections').doc('status')
      .set({ [platform]: true }, { merge: true });

    // Close the Popup
    res.send(`
      <html><body>
      <script>
        // Send message to parent window to refresh
        if (window.opener) {
          window.opener.postMessage({ type: 'OMNIFEED_CONNECTED', platform: '${platform}' }, '*');
        }
        window.close();
      </script>
      <div style="text-align:center; font-family: sans-serif; margin-top: 50px;">
        <h3>Connected!</h3>
        <p>You can close this window.</p>
      </div>
      </body></html>
    `);

  } catch (error) {
    console.error("Callback Error:", error);
    res.status(500).send('Authentication Failed');
  }
});

// 3. Fetch Feed
app.get('/api/feed', verifyAuth, async (req, res) => {
  const uid = req.uid;
  let allPosts = [];

  try {
    const tokensSnap = await db.collection('artifacts').doc('omnifeed-production')
      .collection('users').doc(uid)
      .collection('tokens').get();

    const tokens = {};
    tokensSnap.forEach(doc => tokens[doc.id] = doc.data().accessToken);

    // --- REAL API LOGIC WOULD GO HERE ---
    // if (tokens.twitter) {
    //    const realData = await axios.get('https://api.twitter.com/2/users/me/timelines/reverse_chronological', { headers: { Authorization: `Bearer ${tokens.twitter}` } });
    //    allPosts.push(...transform(realData));
    // }

    // Since we don't have the real API logic implemented yet, we return a "Success" card
    // that proves the Backend <-> Frontend connection is working.
    if (Object.keys(tokens).length > 0) {
      allPosts.push({
        id: `backend_conn_${Date.now()}`,
        platform: 'system',
        author: { name: 'OmniFeed Backend', handle: '@server', avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Server' },
        content: `Securely connected to Render Backend! Found tokens for: ${Object.keys(tokens).join(', ')}. To see real posts, you must implement the specific API calls in server.js using these tokens.`,
        timestamp: 'Live',
        stats: { likes: 0, comments: 0, shares: 0, saved: false, liked: false }
      });
    }

    res.json({ posts: allPosts });

  } catch (error) {
    console.error("Feed Fetch Error:", error);
    res.status(500).json({ error: 'Failed to fetch feeds' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`OmniFeed Backend running on port ${PORT}`));