'use strict';
const { db } = require('./db');

const PROJECT_COLS = `p.*, c.name AS category_name, c.slug AS category_slug,
  m.thumb AS cover_thumb, m.medium AS cover_medium, m.file AS cover_file,
  (SELECT COUNT(*) FROM media mm WHERE mm.project_id = p.id AND mm.kind = 'photo') AS photo_count,
  (SELECT COUNT(*) FROM media mm WHERE mm.project_id = p.id AND mm.kind = 'video') AS video_count`;

const PROJECT_FROM = `FROM projects p
  LEFT JOIN categories c ON c.id = p.category_id
  LEFT JOIN media m ON m.id = COALESCE(p.cover_media_id,
     (SELECT id FROM media x WHERE x.project_id = p.id AND x.kind = 'photo' ORDER BY x.sort_order, x.id LIMIT 1))`;

function listProjects({ status = 'published', category, service, q, featured, limit = 200, offset = 0, sort = 'newest' } = {}) {
  const where = [];
  const params = [];
  if (status && status !== 'all') {
    where.push('p.status = ?');
    params.push(status);
  }
  if (category) {
    where.push('c.slug = ?');
    params.push(category);
  }
  if (service) {
    where.push('p.id IN (SELECT ps.project_id FROM project_services ps JOIN services s ON s.id = ps.service_id WHERE s.slug = ?)');
    params.push(service);
  }
  if (featured) where.push('p.featured = 1');
  if (q) {
    where.push("(p.title LIKE ? OR p.location LIKE ? OR p.tags LIKE ? OR c.name LIKE ? OR (p.show_client = 1 AND p.client_name LIKE ?))");
    const like = `%${q}%`;
    params.push(like, like, like, like, like);
  }
  const order =
    sort === 'oldest'
      ? 'COALESCE(p.year, 0) ASC, p.created_at ASC'
      : sort === 'popular'
        ? 'p.view_count DESC'
        : sort === 'updated'
          ? 'p.updated_at DESC'
          : 'COALESCE(p.published_at, p.created_at) DESC, p.id DESC';
  const sql = `SELECT ${PROJECT_COLS} ${PROJECT_FROM} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ${order} LIMIT ? OFFSET ?`;
  return db.prepare(sql).all(...params, limit, offset);
}

function getProject(by, value) {
  const col = by === 'slug' ? 'p.slug' : 'p.id';
  return db.prepare(`SELECT ${PROJECT_COLS} ${PROJECT_FROM} WHERE ${col} = ?`).get(value);
}

function projectMedia(projectId) {
  return db.prepare('SELECT * FROM media WHERE project_id = ? ORDER BY sort_order, id').all(projectId);
}

function projectServices(projectId) {
  return db
    .prepare('SELECT s.* FROM services s JOIN project_services ps ON ps.service_id = s.id WHERE ps.project_id = ? ORDER BY s.sort_order')
    .all(projectId);
}

function categories() {
  return db.prepare('SELECT c.*, (SELECT COUNT(*) FROM projects p WHERE p.category_id = c.id AND p.status = \'published\') AS project_count FROM categories c ORDER BY sort_order, id').all();
}

function services() {
  return db
    .prepare(
      `SELECT s.*, (SELECT COUNT(*) FROM project_services ps JOIN projects p ON p.id = ps.project_id WHERE ps.service_id = s.id AND p.status = 'published') AS project_count
       FROM services s ORDER BY sort_order, id`
    )
    .all();
}

function testimonials(all = false) {
  return db.prepare(`SELECT * FROM testimonials ${all ? '' : 'WHERE visible = 1'} ORDER BY sort_order, id`).all();
}

function clients() {
  return db.prepare('SELECT * FROM clients ORDER BY sort_order, id').all();
}

function team() {
  return db.prepare('SELECT * FROM team ORDER BY sort_order, id').all();
}

function sitePhotos(grp) {
  return db.prepare('SELECT * FROM site_photos WHERE grp = ? ORDER BY sort_order, id').all(grp);
}

function recordVisit(kind) {
  const day = new Date().toISOString().slice(0, 10);
  db.prepare('INSERT INTO visits (day, kind, count) VALUES (?, ?, 1) ON CONFLICT(day, kind) DO UPDATE SET count = count + 1').run(day, kind);
}

module.exports = { listProjects, getProject, projectMedia, projectServices, categories, services, testimonials, clients, team, sitePhotos, recordVisit };
