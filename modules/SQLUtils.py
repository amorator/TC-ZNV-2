"""Database access layer with connection pooling and simple helpers."""

import mysql.connector as mysql

from classes.user import User
from classes.request import Request
from classes.file import File
from classes.order import Order
from modules.core import Config
from .logging import get_logger

_log = get_logger(__name__)


class SQL(Config):
    """Base SQL class holding connection pool and raw exec helpers."""

    def __init__(self):
        super().__init__()
        self._pool = None

    def with_conn(func):
        def _with_conn(self, command, args=[]):
            if not self._pool:
                _log.info("Creating MySQL connection pool")
                self._pool = mysql.pooling.MySQLConnectionPool(
                    pool_name="znv_pool",
                    pool_size=int(self.config['db'].get('pool_size', 5)),
                    pool_reset_session=True,
                    host=self.config['db']['host'],
                    user=self.config['db']['user'],
                    password=self.config['db']['password'],
                    database=self.config['db']['name'],
                    charset="utf8mb4",
                    collation="utf8mb4_general_ci",
                    connection_timeout=int(self.config['db'].get('connect_timeout', 10)),
                )
            self.conn = self._pool.get_connection()
            # Ensure connection is alive; reconnect if needed
            try:
                self.conn.ping(reconnect=True, attempts=1, delay=0)
            except Exception:
                pass
            # Use buffered cursor to allow fetch after execute reliably
            self.cur = self.conn.cursor(buffered=True)
            data = func(self, command, args)
            self.cur.close()
            self.conn.close()
            return data
        return _with_conn

    @with_conn
    def execute_non_query(self, command, args=[]):
        self.cur.execute(command, args)
        self.conn.commit()

    @with_conn
    def execute_scalar(self, command, args=[]):
        self.cur.execute(command, args)
        return self.cur.fetchone()

    @with_conn
    def execute_query(self, command, args=[]):
        self.cur.execute(command, args)
        return self.cur.fetchall()


class SQLUtils(SQL):
    """High-level, typed helpers that map rows to domain objects."""

    def __init__(self):
        super().__init__()

    '''def init_tables(self):
        self.execute_non_query(f"""CREATE TABLE IF NOT EXISTS {self.config['db']['prefix']}_group (
	id INTEGER UNIQUE AUTO_INCREMENT,
	name VARCHAR(255) NOT NULL UNIQUE,
	PRIMARY KEY(id)
);""")
        self.execute_non_query(f"""CREATE TABLE IF NOT EXISTS {self.config['db']['prefix']}_user (
	id INTEGER UNIQUE AUTO_INCREMENT,
	login VARCHAR(255) NOT NULL UNIQUE,
	name VARCHAR(255) NOT NULL UNIQUE,
	password VARCHAR(32) NOT NULL,
	gid INTEGER NOT NULL DEFAULT 2,
	enabled INTEGER DEFAULT 1,
	permission VARCHAR(50) NOT NULL DEFAULT ",,,",
	PRIMARY KEY(id),
	FOREIGN KEY(gid) REFERENCES web_group(id) ON DELETE RESTRICT
);""")
        self.execute_non_query(f"""CREATE TABLE IF NOT EXISTS {self.config['db']['prefix']}_request (
	id INTEGER UNIQUE AUTO_INCREMENT,
	date VARCHAR(19) NOT NULL,
	creator VARCHAR(255) DEFAULT '',
	account VARCHAR(255) NOT NULL,
	description TEXT NOT NULL,
	status1 TEXT DEFAULT '',
	status2 TEXT DEFAULT '',
	start_date VARCHAR(19) DEFAULT '',
	end_date VARCHAR(19) DEFAULT '',
	final_date VARCHAR(19) DEFAULT '',
	files TEXT DEFAULT '',
	PRIMARY KEY(id)
);""")
        self.execute_non_query(f"""CREATE TABLE IF NOT EXISTS {self.config['db']['prefix']}_file (
	id INTEGER UNIQUE AUTO_INCREMENT,
	display_name VARCHAR(255) NOT NULL,
	real_name VARCHAR(255) NOT NULL,
	path VARCHAR(255) NOT NULL,
	owner VARCHAR(255) NOT NULL,
	description TEXT NOT NULL,
	date VARCHAR(19) NOT NULL,
	ready INTEGER DEFAULT 1,
    viewed BOOL DEFAULT FALSE,
	note TEXT DEFAULT '',
	PRIMARY KEY(id)
);""")
        self.execute_non_query(f"INSERT IGNORE INTO {self.config['db']['prefix']}_group VALUES (%s, %s);", [1, self.config['admin']['group']])
        self.execute_non_query(f"INSERT IGNORE INTO {self.config['db']['prefix']}_user VALUES (%s, %s, %s, %s, %s, %s, %s);", [1, "admin", self.config['admin']['name'], self.config['admin']['password'], 1, 1, 'z,' * (int(self.config['db']['permission_length']) - 1) + 'z'])
'''
    def permission_length(self):
        data = self.execute_scalar(f"SELECT permission FROM {self.config['db']['prefix']}_user LIMIT 1;")
        return len(data[0].split(','))

    def user_by_id(self, args):
        data = self.execute_scalar(f"SELECT * FROM {self.config['db']['prefix']}_user WHERE id = %s;", args)
        return User(*data) if data else None

    def user_by_login(self, args):
        data = self.execute_scalar(f"SELECT * FROM {self.config['db']['prefix']}_user WHERE login LIKE %s;", args)
        return User(*data) if data else None

    def user_exists(self, login, name, id=0):
        uid = self.execute_scalar(f"SELECT id FROM {self.config['db']['prefix']}_user WHERE login LIKE %s OR name LIKE %s;", [login, name])
        return False if not uid else uid[0] != int(id)

    def user_all(self):
        data = self.execute_query(f"SELECT * FROM {self.config['db']['prefix']}_user;")
        return [User(*d) for d in data] if data else None

    def user_toggle(self, args):
        self.execute_non_query(f"UPDATE {self.config['db']['prefix']}_user SET enabled = %s WHERE id = %s;", args)

    def group_all(self):
        data = self.execute_query(f"SELECT * FROM {self.config['db']['prefix']}_group;")
        return {d[0]: d[1] for d in data} if data else None

    def group_name_by_id(self, args):
        return self.execute_scalar(f"SELECT name FROM {self.config['db']['prefix']}_group WHERE id = %s;", args)[0]

    def user_add(self, args):
        self.execute_non_query(f"INSERT INTO {self.config['db']['prefix']}_user (login, name, password, gid, enabled, permission) VALUES (%s, %s, %s, %s, %s, %s);", args)

    def user_edit(self, args):
        self.execute_non_query(f"UPDATE {self.config['db']['prefix']}_user SET login = %s, name = %s, gid = %s, enabled = %s, permission = %s WHERE id = %s;", args)

    def user_delete(self, args):
        self.execute_non_query(f"DELETE FROM {self.config['db']['prefix']}_user WHERE id = %s;", args)

    def user_reset(self, args):
        self.execute_non_query(f"UPDATE {self.config['db']['prefix']}_user SET password = %s WHERE id = %s;", args)


    def request_all(self):
        data = self.execute_query(f"SELECT * FROM {self.config['db']['prefix']}_request;")
        return [Request(*d) for d in data] if data else None

    def request_by_id(self, args):
        data = self.execute_scalar(f"SELECT * FROM {self.config['db']['prefix']}_request WHERE id = %s;", args)
        return Request(*data) if data else None

    def request_edit_status(self, args, st):
        self.execute_non_query(f"UPDATE {self.config['db']['prefix']}_request SET {'status' + str(st)} = %s WHERE id = %s;", args)

    def request_add(self, args):
        self.execute_non_query(f"INSERT INTO {self.config['db']['prefix']}_request (date, creator, account, description, files) VALUES (%s, %s, %s, %s, %s);", args)

    def request_edit_before(self, args):
        self.execute_non_query(f"UPDATE {self.config['db']['prefix']}_request SET creator = %s, description = %s, files = %s WHERE id = %s;", args)

    def request_edit_after(self, args):
        self.execute_non_query(f"UPDATE {self.config['db']['prefix']}_request SET start_date = %s, end_date = %s, final_date = %s WHERE id = %s;", args)

    def request_delete(self, args):
        self.execute_non_query(f"DELETE FROM {self.config['db']['prefix']}_request WHERE id = %s;", args)


    def file_by_id(self, args):
        data = self.execute_scalar(f"SELECT * FROM {self.config['db']['prefix']}_file WHERE id = %s;", args)
        return File(*data) if data else None

    def file_by_path(self, args):
        data = self.execute_query(f"SELECT * FROM {self.config['db']['prefix']}_file WHERE path = %s;", args)
        return [File(*d) for d in data] if data else None

    def file_add(self, args):
        self.execute_non_query(f"INSERT INTO {self.config['db']['prefix']}_file (display_name, real_name, path, owner, description, date, ready) VALUES (%s, %s, %s, %s, %s, %s, %s);", args)
        return self.cur.lastrowid

    def file_edit(self, args):
        self.execute_non_query(f"UPDATE {self.config['db']['prefix']}_file SET display_name = %s, description = %s WHERE id = %s;", args)

    def file_ready(self, args):
        self.execute_non_query(f"UPDATE {self.config['db']['prefix']}_file SET ready = 1 WHERE id = %s;", args)

    def file_delete(self, args):
        self.execute_non_query(f"DELETE FROM {self.config['db']['prefix']}_file WHERE id = %s;", args)

    def file_view(self, args):
        self.execute_non_query(f"UPDATE {self.config['db']['prefix']}_file SET viewed = %s WHERE id = %s;", args)

    def file_note(self, args):
        self.execute_non_query(f"UPDATE {self.config['db']['prefix']}_file SET note = %s WHERE id = %s;", args)
    
    def file_move(self, args):
        self.execute_non_query(f"UPDATE {self.config['db']['prefix']}_file SET path = %s WHERE id = %s;", args)

    def order_all(self):
        data = self.execute_query(f"SELECT * FROM {self.config['db']['prefix']}_order;")
        return [Order(*d) for d in data] if data else None
    
    def order_by_id(self, args):
        data = self.execute_scalar(f"SELECT * FROM {self.config['db']['prefix']}_order WHERE id = %s;", args)
        return Order(*data) if data else None

    def order_add(self, args):
        self.execute_non_query(f"INSERT INTO {self.config['db']['prefix']}_order (state, number, iss_date, start_date, end_date, comp_date, responsible, jobs, department, creator) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s);", args)

    def order_edit(self, args):
        self.execute_non_query(f"UPDATE {self.config['db']['prefix']}_order SET state = %s, number = %s, iss_date = %s, start_date = %s, end_date = %s, comp_date = %s, responsible = %s, jobs = %s, department = %s WHERE id = %s;", args)
        
    def order_edit_attachments(self, args):
        self.execute_non_query(f"UPDATE {self.config['db']['prefix']}_order SET attachments = %s WHERE id = %s;", args)
        
    def order_delete(self, args):
        self.execute_non_query(f"DELETE FROM {self.config['db']['prefix']}_order WHERE id = %s;", args)
        
    def order_status(self, args):
        self.execute_non_query(f"UPDATE {self.config['db']['prefix']}_order SET state = %s, comp_date = %s WHERE id = %s;", args)
        
    def order_approve(self, args):
        self.execute_non_query(f"UPDATE {self.config['db']['prefix']}_order SET approved = %s WHERE id = %s;", args)
        
    def order_view(self, args):
        self.execute_non_query(f"UPDATE {self.config['db']['prefix']}_order SET viewed = %s WHERE id = %s;", args)
        
    def order_note(self, args):
        self.execute_non_query(f"UPDATE {self.config['db']['prefix']}_order SET note = %s WHERE id = %s;", args)
        
    def order_active(self, args):
        date = args[0]
        data = self.execute_query(f'SELECT * FROM znv.web_order WHERE DATE(start_date) <= STR_TO_DATE(%s, "%Y-%m-%d") AND DATE(end_date) >= STR_TO_DATE(%s, "%Y-%m-%d") AND state < 1;', [date, date])
        return [Order(*d) for d in data] if data else None
    