const express = require('express');
const mongoose = require('mongoose');
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

// --- PURE LOCAL LOGIN (No External Requests) ---
app.post('/smartexam/public/student-login', async (req, res) => {
    const rollNo = (req.body.username || req.body.rollNo || req.body.txtUserName || '').trim();
    const password = (req.body.password || req.body.txtPassword || '').trim();

    try {
        const customStudent = await OverrideStudent.findOne({ roll_no: rollNo });

        // 1. If user exists and password matches
        if (customStudent && customStudent.password === password) {
            res.cookie('local_session', rollNo, { httpOnly: true });
            return res.redirect('/smartexam/public/student/dashboard');
        }

        // 2. If user doesn't exist OR password is wrong
        return res.redirect('/?error=invalid');

    } catch (error) {
        console.error("Database connection error during login:", error);
        return res.redirect('/?error=invalid');
    }
});

// --- LOCAL DASHBOARD ---
app.get('/smartexam/public/student/dashboard', async (req, res) => {
    const localSessionRoll = req.cookies.local_session;
    
    if (localSessionRoll) {
        const student = await OverrideStudent.findOne({ roll_no: localSessionRoll });
        if (student) return res.render('custom_dashboard', { student });
    }
    
    // If not logged in, boot them to the homepage
    return res.redirect('/');
});

// --- LOCAL RESULTS PAGE ---
app.get('/smartexam/public/student/student-activity', async (req, res) => {
    const localSessionRoll = req.cookies.local_session;
    
    if (localSessionRoll) {
        const student = await OverrideStudent.findOne({ roll_no: localSessionRoll });
        if (student) return res.render('custom_results', { student });
    }
    
    return res.redirect('/');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
