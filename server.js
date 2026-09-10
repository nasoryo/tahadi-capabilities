require('dotenv').config();
const express = require('express');
const path = require('path');
const { db, getLeaderboard } = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ميدلوير حماية لوحة الإدارة
const authMiddleware = (req, res, next) => {
  const adminKey = req.headers['x-admin-key'];
  if (adminKey && adminKey === ADMIN_PASSWORD) {
    return next();
  }
  return res.status(401).json({ error: 'غير مصرح لك بالوصول. كلمة المرور خاطئة.' });
};

// ------------------- APIs العامة للطلاب ------------------- //

// التحقق من كلمة مرور الأدمن
app.post('/api/auth/verify', (req, res) => {
  const { password } = req.body;
  if (password === ADMIN_PASSWORD) {
    res.json({ success: true, token: ADMIN_PASSWORD });
  } else {
    res.status(401).json({ success: false, message: 'كلمة المرور غير صحيحة' });
  }
});

// جلب الترتيب
app.get('/api/leaderboard', (req, res) => {
  const className = req.query.class;
  getLeaderboard(className, (err, data) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(data);
  });
});

// جلب إحصائيات العامة
app.get('/api/stats', (req, res) => {
  db.get(`SELECT COUNT(*) as totalStudents FROM students`, [], (err, row1) => {
    if (err) return res.status(500).json({ error: err.message });
    db.get(`SELECT COUNT(*) as totalTests FROM tests`, [], (err, row2) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({
        totalStudents: row1 ? row1.totalStudents : 0,
        totalTests: row2 ? row2.totalTests : 0
      });
    });
  });
});

// ------------------- APIs المحمية للإدارة ------------------- //

// جلب جميع الطلاب
app.get('/api/admin/students', authMiddleware, (req, res) => {
  db.all(`SELECT * FROM students ORDER BY name ASC`, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// إضافة طالب
app.post('/api/admin/students', authMiddleware, (req, res) => {
  const { name, class_name } = req.body;
  if (!name || !class_name) return res.status(400).json({ error: 'الاسم والفصل مطلوبان' });

  db.run(`INSERT INTO students (name, class_name) VALUES (?, ?)`, [name.trim(), class_name], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ id: this.lastID, name, class_name });
  });
});

// تعديل طالب
app.put('/api/admin/students/:id', authMiddleware, (req, res) => {
  const { name, class_name } = req.body;
  const { id } = req.params;
  db.run(`UPDATE students SET name = ?, class_name = ? WHERE id = ?`, [name.trim(), class_name, id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true });
  });
});

// حذف طالب
app.delete('/api/admin/students/:id', authMiddleware, (req, res) => {
  const { id } = req.params;
  db.run(`DELETE FROM students WHERE id = ?`, [id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true });
  });
});

// جلب جميع الاختبارات
app.get('/api/admin/tests', authMiddleware, (req, res) => {
  db.all(`SELECT * FROM tests ORDER BY id DESC`, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// إضافة اختبار
app.post('/api/admin/tests', authMiddleware, (req, res) => {
  const { name, max_score } = req.body;
  if (!name) return res.status(400).json({ error: 'اسم الاختبار مطلوب' });

  db.run(`INSERT INTO tests (name, max_score) VALUES (?, ?)`, [name.trim(), max_score || 100], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ id: this.lastID, name, max_score });
  });
});

// حذف اختبار
app.delete('/api/admin/tests/:id', authMiddleware, (req, res) => {
  const { id } = req.params;
  db.run(`DELETE FROM tests WHERE id = ?`, [id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true });
  });
});

// جلب درجات اختبار
app.get('/api/admin/tests/:id/scores', authMiddleware, (req, res) => {
  const { id } = req.params;
  const query = `
    SELECT s.id as student_id, s.name, s.class_name, sc.score 
    FROM students s
    LEFT JOIN scores sc ON s.id = sc.student_id AND sc.test_id = ?
    ORDER BY s.class_name ASC, s.name ASC
  `;
  db.all(query, [id], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// حفظ / تعديل الدرجات
app.post('/api/admin/tests/:id/scores', authMiddleware, (req, res) => {
  const testId = req.params.id;
  const { scores } = req.body;

  if (!Array.isArray(scores)) return res.status(400).json({ error: 'البيانات غير صالحة' });

  const stmt = db.prepare(`
    INSERT INTO scores (student_id, test_id, score) 
    VALUES (?, ?, ?) 
    ON CONFLICT(student_id, test_id) 
    DO UPDATE SET score=excluded.score
  `);

  db.serialize(() => {
    scores.forEach(item => {
      if (item.score !== '' && item.score !== null && !isNaN(item.score)) {
        stmt.run(item.student_id, testId, parseFloat(item.score));
      }
    });
    stmt.finalize(err => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true, message: 'تم حفظ الدرجات وتحديث الترتيب بنجاح' });
    });
  });
});

// توجيه جميع المسارات إلى الصفحة الرئيسية
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// بدء الخادم
app.listen(PORT, () => {
  console.log(`🚀 الخادم يعمل بنجاح على المنفذ: ${PORT}`);
  console.log(`🔗 رابط الطلاب: http://localhost:${PORT}`);
  console.log(`⚙️  لوحة الإدارة: http://localhost:${PORT}/admin.html`);
});
