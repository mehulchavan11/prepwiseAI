const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const { OAuth2Client } = require('google-auth-library');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { parse: parseCsv } = require('csv-parse/sync');
const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

const app = express();
const port = 3000;
const GOOGLE_CLIENT_ID = (process.env.GOOGLE_CLIENT_ID || '').trim() || '256360738968-megf44e1p645q9i970mohprnq2bvr8qc.apps.googleusercontent.com';
const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);

// Allow Google Sign-In popup to communicate with the page
app.use((req, res, next) => {
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
    next();
});

const PYTHON_API_URL = process.env.PYTHON_API_URL || 'http://localhost:8000';

// Serve frontend files from public/
app.use(express.static(path.join(__dirname, 'public')));

// Middleware
app.use(bodyParser.json());
app.use(cors());

// MongoDB connection — cached for serverless (Vercel functions go idle between requests)
let isConnected = false;
async function connectDB() {
    if (isConnected && mongoose.connection.readyState === 1) return;
    await mongoose.connect(process.env.MONGO_URI, { bufferCommands: false });
    isConnected = true;
}

// Reconnect before every request
app.use(async (req, res, next) => {
    try {
        await connectDB();
        next();
    } catch (err) {
        console.error('MongoDB connection error:', err.message);
        res.status(503).json({ message: 'Database unavailable. Please try again.' });
    }
});

// Define the Student schema
const studentSchema = new mongoose.Schema({
    name: String,
    email: String,
    phone: String,
    dob: Date,
    college: String,
    department: String,
    gender: String,
    cgpa: { type: Number, default: null },
    username: { type: String, unique: true, sparse: true },
    password: String,
    googleId: { type: String, unique: true, sparse: true },
    picture: String,
    resumeData: { type: mongoose.Schema.Types.Mixed, default: null },
    resumePdf: { type: String, default: null },
    resumePdfData: { type: String, default: null }, // Base64 PDF stored in MongoDB
});

// Create the Student model
const Student = mongoose.model('Student', studentSchema);

// Define the Admin schema
const adminSchema = new mongoose.Schema({
    name: String,
    position: String,
    email: String,
    phone: String,
    username: { type: String, unique: true },
    password: String, // The password will be hashed
});

// Create the Admin model
const Admin = mongoose.model('Admin', adminSchema);

// Define the Announcement schema
const announcementSchema = new mongoose.Schema({
    title: String,
    content: String,
    createdAt: { type: Date, default: Date.now },
});

// Create the Announcement model
const Announcement = mongoose.model('Announcement', announcementSchema);

// Define the Company schema
const companySchema = new mongoose.Schema({
    name: String,
    email: String,
    company_add: String,
    phone: String,
    username: { type: String, unique: true },
    password: String, // The password will be hashed
});

// Create the Company model
const Company = mongoose.model('Company', companySchema);

// Define the Contact Message schema
const contactSchema = new mongoose.Schema({
    firstName: String,
    lastName:  String,
    email:     String,
    subject:   String,
    message:   String,
    createdAt: { type: Date, default: Date.now },
});
const Contact = mongoose.model('Contact', contactSchema);

// Create an announcement (Admin only)
app.post('/announcements', async (req, res) => {
    try {
        const { title, content } = req.body;
        const newAnnouncement = new Announcement({ title, content });
        await newAnnouncement.save();
        res.status(201).json({ message: 'Announcement created successfully' });
    } catch (error) {
        res.status(500).json({ message: 'Error creating announcement', error });
    }
});

// Get all announcements for students and admins
app.get('/announcements', async (req, res) => {
    try {
        const announcements = await Announcement.find().sort({ createdAt: -1 });
        res.status(200).json(announcements);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching announcements', error });
    }
});

// DELETE an announcement by ID (Admin only)
app.delete('/announcements/:id', async (req, res) => {
    const { id } = req.params;

    try {
        const deletedAnnouncement = await Announcement.findByIdAndDelete(id);

        if (!deletedAnnouncement) {
            return res.status(404).json({ message: 'Announcement not found' });
        }

        res.status(200).json({ message: 'Announcement deleted successfully' });
    } catch (error) {
        res.status(500).json({ message: 'Error deleting announcement', error });
    }
});

// Google OAuth — verify token and find/create student
app.post('/auth/google', async (req, res) => {
    try {
        const { credential } = req.body;
        if (!GOOGLE_CLIENT_ID) {
            return res.status(500).json({ message: 'Google Client ID not configured on server.' });
        }
        const ticket = await googleClient.verifyIdToken({
            idToken: credential,
            audience: GOOGLE_CLIENT_ID,
        });
        const { sub: googleId, email, name, picture } = ticket.getPayload();

        // Find existing student by googleId or email
        let student = await Student.findOne({ $or: [{ googleId }, { email }] });

        if (student) {
            if (!student.googleId) {
                student.googleId = googleId;
                student.picture = picture;
                await student.save();
            }
            return res.status(200).json({
                message: 'Login successful',
                isNewUser: false,
                user: {
                    name: student.name,
                    email: student.email,
                    username: student.username,
                    department: student.department,
                    picture: student.picture || picture,
                }
            });
        }

        // New Google user — profile completion required
        return res.status(200).json({
            message: 'Profile completion required',
            isNewUser: true,
            user: { name, email, googleId, picture }
        });
    } catch (error) {
        console.error('Google auth error:', error.message);
        res.status(401).json({ message: 'Google sign-in failed. Please try again.', error: error.message });
    }
});

// Google OAuth — complete profile for new Google users
app.post('/auth/google/complete', async (req, res) => {
    try {
        const { googleId, name, email, phone, dob, college, department, gender, username, picture } = req.body;

        const existing = await Student.findOne({ username });
        if (existing) {
            return res.status(400).json({ message: 'Username already exists' });
        }

        const newStudent = new Student({
            name, email, phone, dob, college, department, gender,
            username, googleId, picture, password: null,
        });
        await newStudent.save();

        res.status(201).json({
            message: 'Registration successful',
            user: { name, email, username, department, picture }
        });
    } catch (error) {
        if (error.code === 11000) {
            res.status(400).json({ message: 'Username already exists' });
        } else {
            res.status(500).json({ message: 'Error completing registration', error });
        }
    }
});

// Student Registration Route
app.post('/register', async (req, res) => {
    try {
        const { name, email, phone, dob, college, department, gender, username, password } = req.body;

        // Hash the password before saving
        const hashedPassword = await bcrypt.hash(password, 10);

        const newStudent = new Student({
            name,
            email,
            phone,
            dob,
            college,
            department,
            gender,  // Make sure gender is included in the body
            username,
            password: hashedPassword, // Save the hashed password
        });

        await newStudent.save();
        res.status(201).json({ message: 'Student registration successful' });
    } catch (error) {
        if (error.code === 11000) {
            res.status(400).json({ message: 'Username already exists' });
        } else {
            res.status(500).json({ message: 'Error during registration', error });
        }
    }
});

// Student Login Route
app.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body;

        const user = await Student.findOne({ username });

        if (!user) {
            return res.status(401).json({ message: 'Invalid username or password' });
        }

        const isPasswordValid = await bcrypt.compare(password, user.password);

        if (!isPasswordValid) {
            return res.status(401).json({ message: 'Invalid username or password' });
        }

        res.status(200).json({
            message: 'Login successful',
            user: {
                name: user.name,
                username: user.username,
                email: user.email,
                department: user.department,
            }
        });
    } catch (error) {
        res.status(500).json({ message: 'Error during login', error });
    }
});

// Admin Registration Route
app.post('/admin/register', async (req, res) => {
    try {
        const { name, position, email, phone, username, password } = req.body;

        const hashedPassword = await bcrypt.hash(password, 10);

        const newAdmin = new Admin({
            name,
            position,
            email,
            phone,
            username,
            password: hashedPassword,
        });

        await newAdmin.save();
        res.status(201).json({ message: 'Admin registration successful' });
    } catch (error) {
        if (error.code === 11000) {
            res.status(400).json({ message: 'Username already exists' });
        } else {
            res.status(500).json({ message: 'Error during registration', error });
        }
    }
});

// Admin Login Route
app.post('/admin/login', async (req, res) => {
    try {
        const { username, password } = req.body;

        const admin = await Admin.findOne({ username });

        if (!admin) {
            return res.status(401).json({ message: 'Invalid username or password' });
        }

        const isPasswordValid = await bcrypt.compare(password, admin.password);

        if (!isPasswordValid) {
            return res.status(401).json({ message: 'Invalid username or password' });
        }

        res.status(200).json({
            message: 'Admin login successful',
            admin: {
                name: admin.name,
                username: admin.username,
                position: admin.position,
            }
        });
    } catch (error) {
        res.status(500).json({ message: 'Error during login', error });
    }
});

// Student Profile Route
app.get('/student/profile', async (req, res) => {
    try {
        const { username } = req.query;
        const student = await Student.findOne({ username });
        if (!student) {
            return res.status(404).json({ message: 'Student not found' });
        }
        res.status(200).json({
            username: student.username,
            name: student.name,
            email: student.email,
            phone: student.phone,
            department: student.department,
            college: student.college,
            gender: student.gender,
            cgpa: student.cgpa ?? null,
            hasResume: !!(student.resumeData || student.resumePdf),
            resumePdf: student.resumePdf || null,
        });
    } catch (error) {
        res.status(500).json({ message: 'Error fetching student profile', error });
    }
});

// Student Update Route
app.put('/student/update', async (req, res) => {
    const { username, name, email, phone, department, college, gender, cgpa } = req.body;
    if (!username) {
        return res.status(400).json({ message: 'Username is required' });
    }
    const update = { name, email, phone, department, college, gender };
    if (cgpa !== undefined && cgpa !== null && cgpa !== '') {
        const parsed = parseFloat(cgpa);
        if (!isNaN(parsed) && parsed >= 0 && parsed <= 10) update.cgpa = parsed;
    } else if (cgpa === '' || cgpa === null) {
        update.cgpa = null;
    }
    try {
        const updatedStudent = await Student.findOneAndUpdate(
            { username },
            update,
            { new: true }
        );
        if (!updatedStudent) {
            return res.status(404).json({ message: 'Student not found' });
        }
        res.status(200).json({ message: 'Profile updated successfully' });
    } catch (error) {
        res.status(500).json({ message: 'Error updating student profile', error });
    }
});

// Admin Profile Route
app.get('/admin/profile', async (req, res) => {
    try {
        const { username } = req.query; // Expect username in query parameters
        
        // Find the admin by username
        const admin = await Admin.findOne({ username });

        if (!admin) {
            return res.status(404).json({ message: 'Admin not found' });
        }

        // Return admin profile details (excluding password)
        res.status(200).json({
            username: admin.username,
            name: admin.name,
            email: admin.email,
            phone: admin.phone,
            position: admin.position
        });

    } catch (error) {
        res.status(500).json({ message: 'Error fetching admin profile', error });
    }
});

// Admin Update Route
app.put('/admin/update', async (req, res) => {
    const { username, name, email, phone, position } = req.body;
    if (!username) {
        return res.status(400).json({ message: 'Username is required' });
    }
    try {
        const updatedAdmin = await Admin.findOneAndUpdate(
            { username },
            { name, email, phone, position },
            { new: true }
        );
        if (!updatedAdmin) {
            return res.status(404).json({ message: 'Admin not found' });
        }
        res.status(200).json({ message: 'Profile updated successfully' });
    } catch (error) {
        res.status(500).json({ message: 'Error updating admin profile', error });
    }
});

// Get total count of students route
app.get('/students/count', async (req, res) => {
    try {
        const count = await Student.countDocuments(); // Get the count of documents in the collection
        res.status(200).json({ count });
    } catch (error) {
        res.status(500).json({ message: 'Error fetching student count', error });
    }
});

// Get all students route (if you still want to display details later)
app.get('/students', async (req, res) => {
    try {
        const students = await Student.find({});
        res.status(200).json(students);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching students', error });
    }
});

// DELETE a student by username
app.delete('/students/:username', async (req, res) => {
    const username = req.params.username;
    try {
        const deletedStudent = await Student.findOneAndDelete({ username });
        if (deletedStudent) {
            res.json({ message: 'Student deleted successfully' });
        } else {
            res.status(404).json({ message: 'Student not found' });
        }
    } catch (err) {
        res.status(500).json({ message: 'Server error' });
    }
});

// Update student details
app.put('/students/:username', async (req, res) => {
    const username = req.params.username;
    const { name, email, phone, gender, department } = req.body;

    if (!name || !email || !phone) {
        return res.status(400).json({ message: 'All fields (name, email, phone) are required' });
    }

    const updateFields = { name, email, phone, gender };
    if (department !== undefined) updateFields.department = department;

    try {
        const updatedStudent = await Student.findOneAndUpdate(
            { username },
            updateFields,
            { new: true }
        );

        if (updatedStudent) {
            res.json(updatedStudent); // Respond with updated student details
        } else {
            res.status(404).json({ message: 'Student not found' });
        }
    } catch (err) {
        res.status(500).json({ message: 'Server error during student update', error: err.message });
    }
});

// Save student resume data
app.put('/students/:username/resume', async (req, res) => {
    try {
        const { resumeData, cgpa } = req.body;
        const update = { resumeData };
        if (cgpa !== undefined && cgpa !== null && cgpa !== '') update.cgpa = parseFloat(cgpa);
        const student = await Student.findOneAndUpdate(
            { username: req.params.username },
            update,
            { new: true }
        );
        if (!student) return res.status(404).json({ message: 'Student not found' });
        res.json({ message: 'Resume saved successfully' });
    } catch (err) {
        res.status(500).json({ message: 'Error saving resume', error: err.message });
    }
});

// Get student resume data
app.get('/students/:username/resume', async (req, res) => {
    try {
        const student = await Student.findOne({ username: req.params.username }, 'resumeData resumePdf name');
        if (!student) return res.status(404).json({ message: 'Student not found' });
        res.json({ resumeData: student.resumeData, resumePdf: student.resumePdf || null, name: student.name });
    } catch (err) {
        res.status(500).json({ message: 'Error fetching resume', error: err.message });
    }
});

// PDF resume upload — store as Base64 in MongoDB (works on Vercel, no filesystem needed)
const resumeUpload = multer({
    storage: multer.memoryStorage(),
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'application/pdf') cb(null, true);
        else cb(new Error('Only PDF files are allowed'));
    },
    limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
});

app.post('/students/:username/resume/upload', (req, res) => {
    resumeUpload.single('resume')(req, res, async (err) => {
        if (err) return res.status(400).json({ message: err.message || 'Upload failed' });
        try {
            const username = req.params.username;
            if (!req.file) return res.status(400).json({ message: 'No file uploaded' });
            const base64 = req.file.buffer.toString('base64');
            await Student.findOneAndUpdate(
                { username },
                { resumePdfData: base64, resumePdf: `/students/${username}/resume/pdf` }
            );
            res.json({ message: 'Resume uploaded successfully', path: `/students/${username}/resume/pdf` });
        } catch (dbErr) {
            res.status(500).json({ message: dbErr.message || 'Upload failed' });
        }
    });
});

// Serve PDF resume from MongoDB
app.get('/students/:username/resume/pdf', async (req, res) => {
    try {
        const student = await Student.findOne({ username: req.params.username }, 'resumePdfData');
        if (!student || !student.resumePdfData) return res.status(404).send('No PDF resume found');
        const buffer = Buffer.from(student.resumePdfData, 'base64');
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="${req.params.username}_resume.pdf"`);
        res.send(buffer);
    } catch (err) {
        res.status(500).send('Error retrieving resume');
    }
});

// Expose Python API URL to frontend (used for direct proctor calls)
app.get('/config', (req, res) => {
    res.json({ pythonApiUrl: PYTHON_API_URL });
});

// Company Registration Route
app.post('/company/register', async (req, res) => {
    try {
        const { name, email, company_add, phone, username, password } = req.body;

        // Hash the password before saving
        const hashedPassword = await bcrypt.hash(password, 10);

        const newCompany = new Company({
            name,
            email,
            company_add,
            phone,
            username,
            password: hashedPassword,
        });

        await newCompany.save();
        res.status(201).json({ message: 'Company registration successful' });
    } catch (error) {
        if (error.code === 11000) {
            res.status(400).json({ message: 'Username already exists' });
        } else {
            res.status(500).json({ message: 'Error during registration', error });
        }
    }
});

// Company Login Route
app.post('/company/login', async (req, res) => {
    try {
        const { username, password } = req.body;

        const company = await Company.findOne({ username });

        if (!company) {
            return res.status(401).json({ message: 'Invalid username or password' });
        }

        const isPasswordValid = await bcrypt.compare(password, company.password);

        if (!isPasswordValid) {
            return res.status(401).json({ message: 'Invalid username or password' });
        }

        res.status(200).json({
            message: 'Company login successful',
            company: {
                name: company.name,
                username: company.username,
            }
        });
    } catch (error) {
        res.status(500).json({ message: 'Error during login', error });
    }
});

// Contact form — save submission
app.post('/contacts', async (req, res) => {
    try {
        const { firstName, lastName, email, subject, message } = req.body;
        await new Contact({ firstName, lastName, email, subject, message }).save();
        res.status(201).json({ message: 'Message received' });
    } catch (err) {
        res.status(500).json({ message: 'Error saving message', error: err });
    }
});

// Contact form — admin fetch all (newest first)
app.get('/contacts', async (req, res) => {
    try {
        const messages = await Contact.find().sort({ createdAt: -1 });
        res.status(200).json(messages);
    } catch (err) {
        res.status(500).json({ message: 'Error fetching messages', error: err });
    }
});

// Contact form — admin delete by MongoDB _id
app.delete('/contacts/:id', async (req, res) => {
    try {
        const deleted = await Contact.findByIdAndDelete(req.params.id);
        if (!deleted) return res.status(404).json({ message: 'Message not found' });
        res.status(200).json({ message: 'Message deleted' });
    } catch (err) {
        res.status(500).json({ message: 'Error deleting message', error: err });
    }
});

// Company Announcement Route
app.post('/company/announcements', async (req, res) => {
    try {
        const { title, content } = req.body;

        // Assuming company should be authenticated to create an announcement
        const newAnnouncement = new Announcement({ title, content });
        await newAnnouncement.save();
        res.status(201).json({ message: 'Announcement created successfully by company' });
    } catch (error) {
        res.status(500).json({ message: 'Error creating announcement', error });
    }
});

// ── DSA data routes (moved from Python/Render to eliminate cold-start latency) ──
// Code execution (/api/dsa/execute) still runs on Python/Render since it needs the sandbox.

const DSA_CSV_PATH = path.join(__dirname, 'data', 'dsa', 'question_details.csv');
let _dsaCache = null;

function parseListField(raw) {
    if (!raw) return [];
    const s = String(raw).trim();
    if (!s || s === 'nan') return [];
    return s.replace(/^\[|\]$/g, '')
        .split(',')
        .map(t => t.trim().replace(/^['"]|['"]$/g, ''))
        .filter(Boolean);
}

function loadDsaProblems() {
    if (_dsaCache) return _dsaCache;
    const raw = fs.readFileSync(DSA_CSV_PATH, 'utf8');
    const rows = parseCsv(raw, { columns: true, skip_empty_lines: true, relax_quotes: true, relax_column_count: true });
    _dsaCache = rows
        .filter(r => {
            const paid = String(r.isPaidOnly || '').toLowerCase();
            return paid !== 'true';
        })
        .map(r => ({
            qid: parseInt(r.QID, 10),
            title: r.title,
            difficulty: r.difficulty,
            topics: parseListField(r.topics),
            hints: parseListField(r.Hints).filter(h => h.length > 5),
            body: r.Body || '',
            code: r.Code || '',
        }))
        .filter(p => !isNaN(p.qid));
    return _dsaCache;
}

function cleanHtml(raw) {
    const entities = { '&nbsp;': ' ', '&quot;': '"', '&gt;': '>', '&lt;': '<', '&amp;': '&' };
    let out = String(raw || '');
    for (const [k, v] of Object.entries(entities)) out = out.split(k).join(v);
    return out.replace(/<[\s\S]*?>/g, '');
}

function extractTestCases(text) {
    const inputs = [...text.matchAll(/Input:\s*(.+?)(?:\n|$)/gi)].map(m => m[1].trim());
    const outputs = [...text.matchAll(/Output:\s*(.+?)(?:\n|$)/gi)].map(m => m[1].trim());
    const n = Math.min(inputs.length, outputs.length);
    return Array.from({ length: n }, (_, i) => ({ input: inputs[i], output: outputs[i] }));
}

function pythonTemplate(csvCode) {
    const base = String(csvCode || '').trim();
    if (base && base !== 'nan') {
        let b = base;
        if (!/\n\s{8}\S/.test(b)) b = b.replace(/\s+$/, '') + '\n        pass';
        return 'from typing import List, Optional, Dict, Set, Tuple\n\n' + b + '\n';
    }
    return 'from typing import List, Optional, Dict, Set, Tuple\n\nclass Solution:\n    def solve(self):\n        pass\n';
}

const LANG_TEMPLATES = {
    Java: 'import java.util.*;\n\npublic class Solution {\n    // Add your solution here\n}',
    C: '#include <stdio.h>\n#include <stdlib.h>\n\nint main() {\n    // write your code here\n    return 0;\n}',
    'C++': '#include <bits/stdc++.h>\nusing namespace std;\n\nint main() {\n    // write your code here\n    return 0;\n}',
};

// Submissions live in a separate database (DSA_code_app_db) to match the Python app
const dsaSubmissionSchema = new mongoose.Schema({
    username: String,
    qid: Number,
    difficulty: String,
    topics: [String],
    coding_lang: String,
    time_taken: String,
    status: String,
    timestamp: { type: Date, default: Date.now },
}, { collection: 'submissions' });

let DsaSubmission = null;
function getDsaSubmissionModel() {
    if (DsaSubmission) return DsaSubmission;
    const dsaConn = mongoose.connection.useDb('DSA_code_app_db', { useCache: true });
    DsaSubmission = dsaConn.model('Submission', dsaSubmissionSchema);
    return DsaSubmission;
}

app.get('/api/dsa/topics', (req, res) => {
    try {
        const set = new Set();
        loadDsaProblems().forEach(p => p.topics.forEach(t => set.add(t)));
        res.json([...set].sort());
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/dsa/difficulties', (req, res) => {
    try {
        const set = new Set();
        loadDsaProblems().forEach(p => { if (p.difficulty) set.add(p.difficulty); });
        res.json([...set].sort());
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/dsa/problems', (req, res) => {
    try {
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const pageSize = Math.max(1, parseInt(req.query.page_size) || 25);
        const difficulty = req.query.difficulty || '';
        const topic = req.query.topic || '';

        let items = loadDsaProblems();
        if (difficulty && difficulty !== 'All') items = items.filter(p => p.difficulty === difficulty);
        if (topic && topic !== 'All') items = items.filter(p => p.topics.includes(topic));

        const total = items.length;
        const start = (page - 1) * pageSize;
        const chunk = items.slice(start, start + pageSize).map(p => ({
            qid: p.qid, title: p.title, difficulty: p.difficulty, topics: p.topics.slice(0, 4),
        }));

        res.json({ problems: chunk, total, page, page_size: pageSize });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/dsa/problem/:qid', (req, res) => {
    try {
        const qid = parseInt(req.params.qid, 10);
        const p = loadDsaProblems().find(x => x.qid === qid);
        if (!p) return res.json(null);

        const bodyHtml = p.body;
        const bodyText = cleanHtml(bodyHtml);
        res.json({
            qid: p.qid,
            title: p.title,
            difficulty: p.difficulty,
            topics: p.topics,
            body_html: bodyHtml,
            test_cases: extractTestCases(bodyText),
            hints: p.hints,
            templates: {
                Python: pythonTemplate(p.code),
                Java: LANG_TEMPLATES.Java,
                C: LANG_TEMPLATES.C,
                'C++': LANG_TEMPLATES['C++'],
            },
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/dsa/submit', async (req, res) => {
    try {
        const { username, qid, difficulty, topics, language, time_taken } = req.body;
        const Sub = getDsaSubmissionModel();
        await Sub.create({
            username, qid, difficulty, topics,
            coding_lang: language, time_taken, status: 'submitted', timestamp: new Date(),
        });
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/dsa/stats/:username', async (req, res) => {
    try {
        const Sub = getDsaSubmissionModel();
        const subs = await Sub.find({ username: req.params.username }).lean();
        const out = {};
        subs.forEach(s => {
            out[s.qid] = {
                status: s.status,
                time_taken: s.time_taken || '—',
                language: s.coding_lang || '—',
            };
        });
        res.json(out);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/dsa/performance/:username', async (req, res) => {
    try {
        const Sub = getDsaSubmissionModel();
        const subs = await Sub.find({ username: req.params.username }).lean();
        const all = loadDsaProblems();
        const byQid = new Map(all.map(p => [p.qid, p]));

        const problems = subs.map(s => {
            const p = byQid.get(s.qid);
            return {
                qid: s.qid,
                title: p ? p.title : `Problem #${s.qid}`,
                difficulty: p ? p.difficulty : (s.difficulty || '—'),
                topics: p ? p.topics : (Array.isArray(s.topics) ? s.topics : []),
                language: s.coding_lang || '—',
                time_taken: s.time_taken || '—',
                timestamp: s.timestamp ? new Date(s.timestamp).toISOString() : null,
            };
        });
        problems.sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));

        res.json({ problems });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── Mock Interview routes (moved from Python/Render) ──────────────────────────
// Face detection (/api/proctor/detect) still runs on Render (needs OpenCV).

const GEMINI_API_KEY   = process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL_ID  = process.env.GEMINI_MODEL   || 'gemini-2.5-flash';
const genAI = GEMINI_API_KEY ? new GoogleGenerativeAI(GEMINI_API_KEY) : null;

async function geminiCall(prompt) {
    if (!genAI) throw new Error('GEMINI_API_KEY not configured');
    const model = genAI.getGenerativeModel({ model: GEMINI_MODEL_ID });
    const result = await model.generateContent(prompt);
    return result.response.text();
}

// Interview sessions saved to mock_interviews DB (matches Python schema)
const interviewFeedbackSchema = new mongoose.Schema({
    username: String, role: String, question: String,
    answer: String, feedback: String,
    timestamp: { type: Date, default: Date.now },
}, { collection: 'feedbacks' });

const faceLotSchema = new mongoose.Schema({
    student_id: String, violation: String,
    timestamp: { type: Date, default: Date.now },
}, { collection: 'face_logs' });

const cheatingReportSchema = new mongoose.Schema({
    student_id: String, test_type: String, role: String,
    violation_count: Number, violations: Array, terminated: Boolean,
    timestamp: { type: Date, default: Date.now },
}, { collection: 'cheating_reports' });

let _miConn = null;
function getMiConn() {
    if (!_miConn) _miConn = mongoose.connection.useDb('mock_interviews', { useCache: true });
    return _miConn;
}
function getMiModel(name, schema) {
    const conn = getMiConn();
    return conn.models[name] || conn.model(name, schema);
}

app.post('/api/interview/generate', async (req, res) => {
    const { role, stack, experience } = req.body;
    try {
        const prompt =
            `Generate exactly 5 technical interview questions for a ${role} role.\n` +
            `Tech stack: ${stack}. Candidate experience: ${experience} year(s).\n` +
            `Format: number each question on its own line (e.g. '1. What is ...')\n` +
            `Output ONLY the 5 questions, nothing else.`;
        const text = await geminiCall(prompt);
        const questions = text.split('\n')
            .map(l => l.trim())
            .filter(l => l && /^\d/.test(l))
            .map(l => l.replace(/^\d+[\.\)]\s*/, '').trim())
            .filter(Boolean)
            .slice(0, 5);
        if (!questions.length) return res.json({ error: 'Could not generate questions. Please try again.' });
        res.json({ questions });
    } catch (err) {
        if (err.message?.includes('429') || err.message?.includes('RESOURCE_EXHAUSTED')) {
            return res.json({ error: 'API quota exceeded. Please wait a moment and try again.' });
        }
        res.json({ error: `API error: ${err.message}` });
    }
});

app.post('/api/interview/evaluate', async (req, res) => {
    const { question, answer } = req.body;
    if (!answer?.trim()) return res.json({ feedback: 'No answer provided.' });
    try {
        const prompt =
            `Evaluate this interview answer concisely.\n\n` +
            `Question: ${question}\nAnswer: ${answer}\n\n` +
            `Respond with:\nScore: X/10\nFeedback: [2-3 sentences of specific feedback]`;
        const feedback = await geminiCall(prompt);
        res.json({ feedback });
    } catch (err) {
        if (err.message?.includes('RESOURCE_EXHAUSTED')) {
            return res.json({ feedback: '⚠️ API quota exceeded. Feedback unavailable — try again later.' });
        }
        res.json({ feedback: `⚠️ Error generating feedback: ${err.message}` });
    }
});

app.post('/api/interview/save', async (req, res) => {
    const { username, role, stack, experience, responses } = req.body;
    try {
        const Feedback = getMiModel('Feedback', interviewFeedbackSchema);
        const docs = (responses || []).map(r => ({
            username, role, question: r.question,
            answer: r.answer, feedback: r.feedback, timestamp: new Date(),
        }));
        if (docs.length) await Feedback.insertMany(docs);
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

app.post('/api/interview/log-violation', async (req, res) => {
    const { username, violation } = req.body;
    try {
        const FaceLog = getMiModel('FaceLog', faceLotSchema);
        await FaceLog.create({ student_id: username, violation, timestamp: new Date() });
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

app.post('/api/interview/terminate', async (req, res) => {
    const { username, role, violation_count, violations } = req.body;
    try {
        const Report = getMiModel('CheatingReport', cheatingReportSchema);
        await Report.create({
            student_id: username, test_type: 'interview', role,
            violation_count, violations, terminated: true, timestamp: new Date(),
        });
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// Export app for Vercel serverless
module.exports = app;

// Start server locally
if (require.main === module) {
    const server = app.listen(port, () => {
        console.log(`Server running on http://localhost:${port}`);
    });

    server.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
            console.log(`Port ${port} in use — freeing it...`);
            const { exec } = require('child_process');
            exec(
                `for /f "tokens=5" %a in ('netstat -aon ^| findstr ":${port}" ^| findstr "LISTENING"') do taskkill /F /PID %a`,
                { shell: 'cmd.exe' },
                () => setTimeout(() => server.listen(port), 500)
            );
        } else {
            throw err;
        }
    });
}
