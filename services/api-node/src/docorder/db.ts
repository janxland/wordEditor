/**
 * 工单存储：wordEditor 自有 MySQL 库（服务器 100.98.118.42:3306，库名 wordeditor）。
 * 与 AuthCenter（teachersay）完全隔离 —— eorder-server 只做登录鉴权，不承载业务数据。
 * 连接参数可被 DOCORDER_DB_* 环境变量覆盖。
 */
import mysql from 'mysql2/promise';

export interface OrderRow {
  id: number;
  orderNo: string;
  type: 'template' | 'document';
  title: string;
  requirement: string;
  status: 'placed' | 'producing' | 'checking' | 'rework' | 'delivered' | 'cancelled';
  customerId: number;
  customerName: string;
  workerId: number | null;
  workerName: string | null;
  createTime: string;
  updateTime: string;
}

export interface AttachmentRow {
  id: number;
  orderId: number;
  kind: 'requirement' | 'deliverable';
  name: string;
  url: string;
  size: number | null;
  uploadedBy: string;
  uploadedAt: string;
}

export interface TimelineRow {
  id: number;
  orderId: number;
  status: string;
  by: string;
  byUserId: number;
  note: string | null;
  at: string;
}

export interface DocOrderStore {
  createOrder(input: {
    type: string;
    title: string;
    requirement: string;
    customerId: number;
    customerName: string;
  }): Promise<OrderRow>;
  addAttachments(
    orderId: number,
    kind: AttachmentRow['kind'],
    items: { name: string; url: string; size?: number | null }[],
    uploadedBy: string,
  ): Promise<void>;
  addTimeline(orderId: number, entry: { status: string; by: string; byUserId: number; note?: string }): Promise<void>;
  getOrder(id: number): Promise<OrderRow | undefined>;
  listByCustomer(customerId: number): Promise<OrderRow[]>;
  listQueue(): Promise<OrderRow[]>;
  updateOrder(id: number, fields: Partial<Pick<OrderRow, 'status' | 'workerId' | 'workerName'>>): Promise<void>;
  attachmentsOf(orderId: number): Promise<AttachmentRow[]>;
  timelineOf(orderId: number): Promise<TimelineRow[]>;
}

const pad = (n: number, w = 2): string => String(n).padStart(w, '0');

const DDL = `
CREATE TABLE IF NOT EXISTS orders (
  id INT AUTO_INCREMENT PRIMARY KEY,
  order_no VARCHAR(32) NOT NULL UNIQUE,
  type VARCHAR(16) NOT NULL,
  title VARCHAR(200) NOT NULL,
  requirement MEDIUMTEXT NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'placed',
  customer_id INT NOT NULL,
  customer_name VARCHAR(64) NOT NULL,
  worker_id INT NULL,
  worker_name VARCHAR(64) NULL,
  create_time DATETIME(3) NOT NULL,
  update_time DATETIME(3) NOT NULL,
  INDEX idx_orders_customer (customer_id),
  INDEX idx_orders_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS attachments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  order_id INT NOT NULL,
  kind VARCHAR(16) NOT NULL,
  name VARCHAR(255) NOT NULL,
  url VARCHAR(500) NOT NULL,
  size BIGINT NULL,
  uploaded_by VARCHAR(64) NOT NULL,
  uploaded_at DATETIME(3) NOT NULL,
  INDEX idx_att_order (order_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS timeline (
  id INT AUTO_INCREMENT PRIMARY KEY,
  order_id INT NOT NULL,
  status VARCHAR(16) NOT NULL,
  actor VARCHAR(64) NOT NULL,
  by_user_id INT NOT NULL,
  note TEXT NULL,
  at DATETIME(3) NOT NULL,
  INDEX idx_tl_order (order_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`;

export function openDocOrderStore(): DocOrderStore {
  const pool = mysql.createPool({
    host: process.env.DOCORDER_DB_HOST ?? '100.98.118.42',
    port: Number(process.env.DOCORDER_DB_PORT ?? 3306),
    user: process.env.DOCORDER_DB_USER ?? 'wordeditor',
    // 凭据一律走环境变量（见 apps/wordeditor-desktop/env.example）；仓库是 public，禁止在代码里留默认值
    password: process.env.DOCORDER_DB_PASSWORD ?? '',
    database: process.env.DOCORDER_DB_NAME ?? 'wordeditor',
    waitForConnections: true,
    connectionLimit: 5,
    charset: 'utf8mb4',
  });

  for (const stmt of DDL.split(';').map((x) => x.trim()).filter(Boolean)) {
    void pool.query(stmt).catch((err) => {
      // 建表失败不影响启动，首次请求时会再暴露
      console.error('[docorder] DDL failed:', err.message);
    });
  }

  const now = (): string => {
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
  };

  const makeOrderNo = (): string => {
    const d = new Date();
    const ymd = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
    const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
    return `DO${ymd}${rand}`;
  };

  const rowToOrder = (r: any): OrderRow => ({
    id: Number(r.id),
    orderNo: String(r.order_no),
    type: r.type,
    title: String(r.title),
    requirement: String(r.requirement ?? ''),
    status: r.status,
    customerId: Number(r.customer_id),
    customerName: String(r.customer_name),
    workerId: r.worker_id == null ? null : Number(r.worker_id),
    workerName: r.worker_name == null ? null : String(r.worker_name),
    createTime: r.create_time instanceof Date ? r.create_time.toISOString() : String(r.create_time),
    updateTime: r.update_time instanceof Date ? r.update_time.toISOString() : String(r.update_time),
  });

  const store: DocOrderStore = {
    async createOrder(input) {
      const t = now();
      const [res] = await pool.execute(
        `INSERT INTO orders (order_no, type, title, requirement, status, customer_id, customer_name, create_time, update_time)
         VALUES (?, ?, ?, ?, 'placed', ?, ?, ?, ?)`,
        [makeOrderNo(), input.type, input.title, input.requirement, input.customerId, input.customerName, t, t],
      );
      return (await store.getOrder((res as mysql.ResultSetHeader).insertId))!;
    },
    async addAttachments(orderId, kind, items, uploadedBy) {
      const t = now();
      for (const it of items) {
        await pool.execute(
          `INSERT INTO attachments (order_id, kind, name, url, size, uploaded_by, uploaded_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [orderId, kind, it.name, it.url, it.size ?? null, uploadedBy, t],
        );
      }
    },
    async addTimeline(orderId, entry) {
      await pool.execute(
        `INSERT INTO timeline (order_id, status, actor, by_user_id, note, at) VALUES (?, ?, ?, ?, ?, ?)`,
        [orderId, entry.status, entry.by, entry.byUserId, entry.note ?? null, now()],
      );
    },
    async getOrder(id) {
      const [rows] = await pool.query(`SELECT * FROM orders WHERE id = ?`, [id]);
      const list = rows as any[];
      return list.length ? rowToOrder(list[0]) : undefined;
    },
    async listByCustomer(customerId) {
      const [rows] = await pool.query(`SELECT * FROM orders WHERE customer_id = ? ORDER BY id DESC`, [customerId]);
      return (rows as any[]).map(rowToOrder);
    },
    async listQueue() {
      const [rows] = await pool.query(
        `SELECT * FROM orders WHERE status NOT IN ('cancelled', 'delivered') ORDER BY id ASC`,
      );
      return (rows as any[]).map(rowToOrder);
    },
    async updateOrder(id, fields) {
      const sets: string[] = [];
      const vals: (string | number | null)[] = [];
      if (fields.status !== undefined) { sets.push('status = ?'); vals.push(fields.status); }
      if (fields.workerId !== undefined) { sets.push('worker_id = ?'); vals.push(fields.workerId); }
      if (fields.workerName !== undefined) { sets.push('worker_name = ?'); vals.push(fields.workerName); }
      sets.push('update_time = ?'); vals.push(now());
      vals.push(id);
      await pool.execute(`UPDATE orders SET ${sets.join(', ')} WHERE id = ?`, vals);
    },
    async attachmentsOf(orderId) {
      const [rows] = await pool.query(`SELECT * FROM attachments WHERE order_id = ? ORDER BY id ASC`, [orderId]);
      return (rows as any[]).map((r) => ({
        id: Number(r.id),
        orderId: Number(r.order_id),
        kind: r.kind,
        name: String(r.name),
        url: String(r.url),
        size: r.size == null ? null : Number(r.size),
        uploadedBy: String(r.uploaded_by),
        uploadedAt: r.uploaded_at instanceof Date ? r.uploaded_at.toISOString() : String(r.uploaded_at),
      }));
    },
    async timelineOf(orderId) {
      const [rows] = await pool.query(
        `SELECT id, order_id, status, actor AS \`by\`, by_user_id, note, at FROM timeline WHERE order_id = ? ORDER BY id ASC`,
        [orderId],
      );
      return (rows as any[]).map((r) => ({
        id: Number(r.id),
        orderId: Number(r.order_id),
        status: String(r.status),
        by: String(r.by),
        byUserId: Number(r.by_user_id),
        note: r.note == null ? null : String(r.note),
        at: r.at instanceof Date ? r.at.toISOString() : String(r.at),
      }));
    },
  };

  return store;
}
