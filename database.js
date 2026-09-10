const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

// تحديد مسار قاعدة البيانات من المتغيرات البيئية أو الافتراضي
const dbPath = process.env.DB_PATH || path.resolve(__dirname, 'data', 'qudrat.db');

// إنشاء المجلد تلقائياً إذا لم يكن موجوداً (مهم جداً للاستضافة)
const dir = path.dirname(dbPath);
if (!fs.existsSync(dir)) {
  fs.mkdirSync(dir, { recursive: true });
}

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('❌ خطأ في الاتصال بقاعدة البيانات:', err.message);
  } else {
    console.log('✅ تم الاتصال بقاعدة البيانات بنجاح على المسار:', dbPath);
  }
});

// تفعيل وضع WAL لأداء أسرع واستقرار أكثر
db.run('PRAGMA journal_mode = WAL;');

// إنشاء الجداول
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS students (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      class_name TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS tests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      max_score REAL DEFAULT 100,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS scores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id INTEGER NOT NULL,
      test_id INTEGER NOT NULL,
      score REAL NOT NULL,
      FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
      FOREIGN KEY (test_id) REFERENCES tests(id) ON DELETE CASCADE,
      UNIQUE(student_id, test_id)
    )
  `);
});

// جلب قائمة الترتيب المحدثة تلقائياً
function getLeaderboard(classNameFilter = null, callback) {
  let query = `
    SELECT 
      s.id,
      s.name,
      s.class_name,
      COUNT(sc.id) as tests_count,
      COALESCE(SUM(sc.score), 0) as total_score,
      COALESCE(ROUND(AVG(sc.score), 2), 0) as avg_score
    FROM students s
    LEFT JOIN scores sc ON s.id = sc.student_id
  `;

  const params = [];
  if (classNameFilter && classNameFilter !== 'جميع الفصول') {
    query += ` WHERE s.class_name = ? `;
    params.push(classNameFilter);
  }

  query += `
    GROUP BY s.id
    ORDER BY avg_score DESC, total_score DESC, s.name ASC
  `;

  db.all(query, params, (err, rows) => {
    if (err) return callback(err, null);
    
    const rankedData = rows.map((student, index) => ({
      rank: index + 1,
      ...student
    }));
    
    callback(null, rankedData);
  });
}

module.exports = { db, getLeaderboard };
