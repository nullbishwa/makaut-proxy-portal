const express = require('express');
const mongoose = require('mongoose');
const axios = require('axios');
const path = require('path');
const cookieParser = require('cookie-parser');
const multer = require('multer');

const app = express();

const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

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
    pdf_data: { type: Buffer, required: true },
    pdf_contentType: { type: String, required: true }
});

const OverrideStudent = mongoose.model('OverrideStudent', overrideSchema);
const ADMIN_SECRET = process.env.ADMIN_SECRET || 'makaut_admin_secret_2026';

const requireAdmin = (req, res, next) => {
    if (req.cookies.admin_session === ADMIN_SECRET) next();
    else res.redirect('/admin-portal');
};

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.get('/admin-portal', (req, res) => res.render('admin_login', { error: null }));

app.post('/admin-auth', (req, res) => {
    if (req.body.secret === ADMIN_SECRET) {
        res.cookie('admin_session', ADMIN_SECRET, { httpOnly: true });
        return res.redirect('/admin/dashboard');
    }
    res.render('admin_login', { error: 'Invalid Secret Key!' });
});

app.get('/admin/dashboard', requireAdmin, (req, res) => {
    res.render('admin_dashboard', { success: req.query.success });
});

app.get('/admin/edit/:rollNo', requireAdmin, (req, res) => {
    res.render('admin_edit', { rollNo: req.params.rollNo });
});

app.post('/api/admin/save-override', requireAdmin, upload.single('result_pdf'), async (req, res) => {
    const roll_no = req.body.roll_no;
    const pdfFile = req.file;

    if (!pdfFile) return res.send("No file uploaded!");

    let targetPassword = "";
    let targetName = "Student";
    
    if (roll_no === "32342724111") {
        targetPassword = "18122005";
        targetName = "BISHWAROOP DAS";
    } else if (roll_no === "32342724048") {
        targetPassword = "11052006";
        targetName = "SARANNYA MUKHOPADHYAY";
    }

    try {
        await OverrideStudent.findOneAndUpdate(
            { roll_no },
            { 
                password: targetPassword,
                student_name: targetName,
                pdf_data: pdfFile.buffer,
                pdf_contentType: pdfFile.mimetype
            },
            { upsert: true, new: true }
        );
        res.redirect('/admin/dashboard?success=PDF Result successfully uploaded for Roll No: ' + roll_no);
    } catch (err) {
        res.send("Database error: " + err.message);
    }
});

app.post('/smartexam/public/student-login', async (req, res) => {
    const rollNo = req.body.username || req.body.rollNo || req.body.txtUserName;
    const password = req.body.password || req.body.txtPassword;

    try {
        const customStudent = await OverrideStudent.findOne({ roll_no: rollNo?.trim() });

        if (customStudent && customStudent.password === password?.trim()) {
            res.cookie('local_session', rollNo.trim(), { httpOnly: true });
            return res.redirect('/smartexam/public/student/dashboard');
        }

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
        if (setCookieHeader) res.setHeader('Set-Cookie', setCookieHeader);

        if (officialResponse.status === 302 || officialResponse.headers['location']) {
            return res.redirect(officialResponse.headers['location']);
        }
        return res.send(officialResponse.data);

    } catch (error) {
        try {
            const fallbackResponse = await axios.post('https://makaut1.ucanapply.com/smartexam/public/student-login', 
                new URLSearchParams(req.body), {
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
                }
            );
            return res.send(fallbackResponse.data);
        } catch (err2) {
            res.status(500).send("Error communicating with official server.");
        }
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

app.get('/student/view-pdf', async (req, res) => {
    const localSessionRoll = req.cookies.local_session;
    if (localSessionRoll) {
        const student = await OverrideStudent.findOne({ roll_no: localSessionRoll });
        if (student && student.pdf_data) {
            res.contentType(student.pdf_contentType);
            return res.send(student.pdf_data);
        }
    }
    res.send("Result file not found or you are not logged in.");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
