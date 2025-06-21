import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import mime from 'mime-types';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = 'your-super-secret-jwt-key-change-in-production';

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Create necessary directories
const uploadsDir = path.join(__dirname, '../uploads');
const notesDir = path.join(__dirname, '../notes');
const shareLinksFile = path.join(__dirname, '../share-links.json');

if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

if (!fs.existsSync(notesDir)) {
  fs.mkdirSync(notesDir, { recursive: true });
}

// Initialize share links storage
if (!fs.existsSync(shareLinksFile)) {
  fs.writeFileSync(shareLinksFile, JSON.stringify({}));
}

// Admin credentials
const ADMIN_CREDENTIALS = {
  username: 'sunny',
  password: 'SANDEEP1717a'
};

// Helper functions for share links
const getShareLinks = () => {
  try {
    return JSON.parse(fs.readFileSync(shareLinksFile, 'utf8'));
  } catch {
    return {};
  }
};

const saveShareLinks = (links) => {
  fs.writeFileSync(shareLinksFile, JSON.stringify(links, null, 2));
};

// Multer configuration for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + '-' + file.originalname);
  }
});

const upload = multer({ 
  storage,
  limits: {
    fileSize: 50 * 1024 * 1024 // 50MB limit
  }
});

// Authentication middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }
    req.user = user;
    next();
  });
};

// Auth routes
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (username !== ADMIN_CREDENTIALS.username || password !== ADMIN_CREDENTIALS.password) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { username: ADMIN_CREDENTIALS.username },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({ token, username: ADMIN_CREDENTIALS.username });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// File routes
app.get('/api/files', authenticateToken, (req, res) => {
  try {
    const files = fs.readdirSync(uploadsDir).map(filename => {
      const filePath = path.join(uploadsDir, filename);
      const stats = fs.statSync(filePath);
      
      return {
        name: filename,
        originalName: filename.split('-').slice(2).join('-'),
        size: stats.size,
        modified: stats.mtime,
        type: mime.lookup(filename) || 'application/octet-stream'
      };
    });

    res.json(files);
  } catch (error) {
    res.status(500).json({ error: 'Failed to list files' });
  }
});

app.post('/api/upload', authenticateToken, upload.single('file'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    res.json({
      message: 'File uploaded successfully',
      file: {
        name: req.file.filename,
        originalName: req.file.originalname,
        size: req.file.size,
        type: req.file.mimetype
      }
    });
  } catch (error) {
    res.status(500).json({ error: 'Upload failed' });
  }
});

app.get('/api/download/:filename', authenticateToken, (req, res) => {
  try {
    const filename = req.params.filename;
    const filePath = path.join(uploadsDir, filename);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found' });
    }

    const originalName = filename.split('-').slice(2).join('-');
    res.download(filePath, originalName);
  } catch (error) {
    res.status(500).json({ error: 'Download failed' });
  }
});

// View file content (for text files, images, etc.)
app.get('/api/view/:filename', authenticateToken, (req, res) => {
  try {
    const filename = req.params.filename;
    const filePath = path.join(uploadsDir, filename);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found' });
    }

    const mimeType = mime.lookup(filename) || 'application/octet-stream';
    
    // For text files, return content as JSON
    if (mimeType.startsWith('text/')) {
      const content = fs.readFileSync(filePath, 'utf8');
      res.json({ content, type: mimeType });
    } else {
      // For other files, serve them directly
      res.setHeader('Content-Type', mimeType);
      res.sendFile(filePath);
    }
  } catch (error) {
    res.status(500).json({ error: 'Failed to view file' });
  }
});

// Edit file content (for text files)
app.put('/api/edit/:filename', authenticateToken, (req, res) => {
  try {
    const filename = req.params.filename;
    const { content } = req.body;
    const filePath = path.join(uploadsDir, filename);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found' });
    }

    const mimeType = mime.lookup(filename) || 'application/octet-stream';
    
    if (!mimeType.startsWith('text/')) {
      return res.status(400).json({ error: 'File is not editable' });
    }

    fs.writeFileSync(filePath, content);
    res.json({ message: 'File updated successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update file' });
  }
});

// Create share link
app.post('/api/share/:filename', authenticateToken, (req, res) => {
  try {
    const filename = req.params.filename;
    const filePath = path.join(uploadsDir, filename);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found' });
    }

    const shareId = crypto.randomBytes(16).toString('hex');
    const shareLinks = getShareLinks();
    
    shareLinks[shareId] = {
      filename,
      originalName: filename.split('-').slice(2).join('-'),
      created: new Date().toISOString(),
      downloads: 0
    };
    
    saveShareLinks(shareLinks);

    const shareUrl = `${req.protocol}://${req.get('host')}/share/${shareId}`;
    res.json({ shareUrl, shareId });
  } catch (error) {
    res.status(500).json({ error: 'Failed to create share link' });
  }
});

// Public share page (no authentication required)
app.get('/share/:shareId', (req, res) => {
  try {
    const shareId = req.params.shareId;
    const shareLinks = getShareLinks();
    const shareInfo = shareLinks[shareId];

    if (!shareInfo) {
      return res.status(404).send(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>File Not Found</title>
          <script src="https://cdn.tailwindcss.com"></script>
        </head>
        <body class="bg-gray-100 min-h-screen flex items-center justify-center">
          <div class="bg-white p-8 rounded-lg shadow-md text-center">
            <h1 class="text-2xl font-bold text-red-600 mb-4">File Not Found</h1>
            <p class="text-gray-600">The shared file link is invalid or has expired.</p>
          </div>
        </body>
        </html>
      `);
    }

    const filePath = path.join(uploadsDir, shareInfo.filename);
    if (!fs.existsSync(filePath)) {
      return res.status(404).send(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>File Not Found</title>
          <script src="https://cdn.tailwindcss.com"></script>
        </head>
        <body class="bg-gray-100 min-h-screen flex items-center justify-center">
          <div class="bg-white p-8 rounded-lg shadow-md text-center">
            <h1 class="text-2xl font-bold text-red-600 mb-4">File Not Found</h1>
            <p class="text-gray-600">The file no longer exists on the server.</p>
          </div>
        </body>
        </html>
      `);
    }

    const stats = fs.statSync(filePath);
    const fileSize = (stats.size / 1024 / 1024).toFixed(2);
    const mimeType = mime.lookup(shareInfo.filename) || 'application/octet-stream';

    res.send(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Download ${shareInfo.originalName}</title>
        <script src="https://cdn.tailwindcss.com"></script>
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/lucide/0.344.0/lucide.min.css">
      </head>
      <body class="bg-gradient-to-br from-blue-50 to-indigo-100 min-h-screen flex items-center justify-center p-4">
        <div class="bg-white rounded-xl shadow-lg p-8 max-w-md w-full">
          <div class="text-center mb-6">
            <div class="mx-auto h-16 w-16 bg-blue-600 rounded-full flex items-center justify-center mb-4">
              <svg class="h-8 w-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
              </svg>
            </div>
            <h1 class="text-2xl font-bold text-gray-900 mb-2">File Download</h1>
            <p class="text-gray-600">Click the button below to download your file</p>
          </div>
          
          <div class="bg-gray-50 rounded-lg p-4 mb-6">
            <div class="flex items-center space-x-3">
              <div class="flex-shrink-0">
                <svg class="h-8 w-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
                </svg>
              </div>
              <div class="flex-1 min-w-0">
                <p class="text-sm font-medium text-gray-900 truncate">${shareInfo.originalName}</p>
                <p class="text-sm text-gray-500">${fileSize} MB • ${mimeType}</p>
              </div>
            </div>
          </div>
          
          <button 
            onclick="downloadFile()"
            class="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 px-4 rounded-lg transition-colors duration-200 flex items-center justify-center space-x-2"
          >
            <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path>
            </svg>
            <span>Download File</span>
          </button>
          
          <div class="mt-4 text-center">
            <p class="text-xs text-gray-500">
              Shared on ${new Date(shareInfo.created).toLocaleDateString()}
            </p>
          </div>
        </div>
        
        <script>
          function downloadFile() {
            window.location.href = '/api/share-download/${shareId}';
          }
        </script>
      </body>
      </html>
    `);
  } catch (error) {
    res.status(500).send('Server error');
  }
});

// Public download endpoint (no authentication required)
app.get('/api/share-download/:shareId', (req, res) => {
  try {
    const shareId = req.params.shareId;
    const shareLinks = getShareLinks();
    const shareInfo = shareLinks[shareId];

    if (!shareInfo) {
      return res.status(404).json({ error: 'Invalid share link' });
    }

    const filePath = path.join(uploadsDir, shareInfo.filename);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found' });
    }

    // Update download count
    shareInfo.downloads += 1;
    shareLinks[shareId] = shareInfo;
    saveShareLinks(shareLinks);

    res.download(filePath, shareInfo.originalName);
  } catch (error) {
    res.status(500).json({ error: 'Download failed' });
  }
});

app.delete('/api/files/:filename', authenticateToken, (req, res) => {
  try {
    const filename = req.params.filename;
    const filePath = path.join(uploadsDir, filename);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found' });
    }

    fs.unlinkSync(filePath);
    res.json({ message: 'File deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Delete failed' });
  }
});

// Notes routes
app.get('/api/notes', authenticateToken, (req, res) => {
  try {
    const notes = fs.readdirSync(notesDir).map(filename => {
      const filePath = path.join(notesDir, filename);
      const stats = fs.statSync(filePath);
      const content = fs.readFileSync(filePath, 'utf8');
      
      return {
        id: filename.replace('.txt', ''),
        title: filename.replace('.txt', ''),
        content: content.substring(0, 100) + (content.length > 100 ? '...' : ''),
        modified: stats.mtime
      };
    });

    res.json(notes);
  } catch (error) {
    res.status(500).json({ error: 'Failed to list notes' });
  }
});

app.get('/api/notes/:id', authenticateToken, (req, res) => {
  try {
    const noteId = req.params.id;
    const filePath = path.join(notesDir, `${noteId}.txt`);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Note not found' });
    }

    const content = fs.readFileSync(filePath, 'utf8');
    res.json({ id: noteId, content });
  } catch (error) {
    res.status(500).json({ error: 'Failed to read note' });
  }
});

app.post('/api/notes', authenticateToken, (req, res) => {
  try {
    const { title, content } = req.body;
    const noteId = title.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
    const filePath = path.join(notesDir, `${noteId}.txt`);

    fs.writeFileSync(filePath, content);
    res.json({ message: 'Note saved successfully', id: noteId });
  } catch (error) {
    res.status(500).json({ error: 'Failed to save note' });
  }
});

app.put('/api/notes/:id', authenticateToken, (req, res) => {
  try {
    const noteId = req.params.id;
    const { content } = req.body;
    const filePath = path.join(notesDir, `${noteId}.txt`);

    fs.writeFileSync(filePath, content);
    res.json({ message: 'Note updated successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update note' });
  }
});

app.delete('/api/notes/:id', authenticateToken, (req, res) => {
  try {
    const noteId = req.params.id;
    const filePath = path.join(notesDir, `${noteId}.txt`);

    if (!fs.existsExists(filePath)) {
      return res.status(404).json({ error: 'Note not found' });
    }

    fs.unlinkSync(filePath);
    res.json({ message: 'Note deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete note' });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});