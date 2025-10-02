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
        # Initialize database schema on startup
        self._ensure_database_schema()

    def _ensure_database_schema(self):
        """Create database tables if they don't exist and insert default data.
        
        Creates the following tables with proper indexes and constraints:
        - web_group: User groups with descriptions
        - web_user: Users with authentication and permissions  
        - web_file: File metadata with media information
        - web_request: Service requests
        - web_order: Service orders
        
        Also creates default admin group and user if they don't exist.
        """
        # Create groups table
        self.execute_non_query(f"""CREATE TABLE IF NOT EXISTS {self.config['db']['prefix']}_group (
    id INTEGER UNIQUE AUTO_INCREMENT,
    name VARCHAR(255) NOT NULL UNIQUE,
    description TEXT DEFAULT '',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY(id)
);""")
        
        # Create users table
        self.execute_non_query(f"""CREATE TABLE IF NOT EXISTS {self.config['db']['prefix']}_user (
    id INTEGER UNIQUE AUTO_INCREMENT,
    login VARCHAR(255) NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL UNIQUE,
    password VARCHAR(32) NOT NULL,
    gid INTEGER NOT NULL DEFAULT 2,
    enabled INTEGER DEFAULT 1,
    permission VARCHAR(50) NOT NULL DEFAULT ',,,',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY(id),
    FOREIGN KEY(gid) REFERENCES {self.config['db']['prefix']}_group(id) ON DELETE RESTRICT
);""")
        
        # Create files table
        self.execute_non_query(f"""CREATE TABLE IF NOT EXISTS {self.config['db']['prefix']}_file (
    id INTEGER UNIQUE AUTO_INCREMENT,
    display_name VARCHAR(255) NOT NULL,
    real_name VARCHAR(255) NOT NULL,
    path VARCHAR(255) NOT NULL,
    owner VARCHAR(255) NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    date VARCHAR(19) NOT NULL,
    ready INTEGER DEFAULT 1,
    viewed TEXT DEFAULT '',
    note TEXT DEFAULT '',
    length_seconds INTEGER DEFAULT 0,
    size_mb DECIMAL(10,2) DEFAULT 0.00,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY(id)
);""")
        
        # Create requests table
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
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY(id)
);""")
        
        # Create orders table
        self.execute_non_query(f"""CREATE TABLE IF NOT EXISTS {self.config['db']['prefix']}_order (
    id INTEGER UNIQUE AUTO_INCREMENT,
    date VARCHAR(19) NOT NULL,
    creator VARCHAR(255) DEFAULT '',
    account VARCHAR(255) NOT NULL,
    description TEXT NOT NULL,
    status TEXT DEFAULT '',
    files TEXT DEFAULT '',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY(id)
);""")
        
        # Insert default admin group and user
        permission_length = int(self.config['db'].get('permission_length', 5))
        admin_permissions = 'z,' * (permission_length - 1) + 'z'
        
        self.execute_non_query(f"INSERT IGNORE INTO {self.config['db']['prefix']}_group (id, name, description) VALUES (%s, %s, %s);", 
                              [1, self.config['admin']['group'], 'Администраторы'])
        self.execute_non_query(f"INSERT IGNORE INTO {self.config['db']['prefix']}_user (id, login, name, password, gid, enabled, permission) VALUES (%s, %s, %s, %s, %s, %s, %s);", 
                              [1, "admin", self.config['admin']['name'], self.config['admin']['password'], 1, 1, admin_permissions])

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

    def permission_length(self):
        data = self.execute_scalar(f"SELECT permission FROM {self.config['db']['prefix']}_user LIMIT 1;")
        return len(data[0].split(','))

    def group_name_by_id(self, args):
        return self.execute_scalar(f"SELECT name FROM {self.config['db']['prefix']}_group WHERE id = %s;", args)[0]

    # File management functions
    def file_by_id(self, args):
        """Get file by ID."""
        from classes.file import File
        data = self.execute_scalar(f"SELECT id, display_name, real_name, path, owner, description, date, ready, viewed, note, length_seconds, size_mb FROM {self.config['db']['prefix']}_file WHERE id = %s;", args)
        return File(*data) if data else None

    def file_by_path(self, args):
        """Get files by path."""
        from classes.file import File
        data = self.execute_query(f"SELECT id, display_name, real_name, path, owner, description, date, ready, viewed, note, length_seconds, size_mb FROM {self.config['db']['prefix']}_file WHERE path = %s;", args)
        return [File(*d) for d in data] if data else None

    def file_all(self):
        """Get all files."""
        from classes.file import File
        data = self.execute_query(f"SELECT id, display_name, real_name, path, owner, description, date, ready, viewed, note, length_seconds, size_mb FROM {self.config['db']['prefix']}_file;")
        return [File(*d) for d in data] if data else None

    def file_add(self, args):
        """Add new file. Args: [display_name, real_name, path, owner, description, date, ready, length_seconds, size_mb]"""
        self.execute_non_query(
            f"INSERT INTO {self.config['db']['prefix']}_file (display_name, real_name, path, owner, description, date, ready, length_seconds, size_mb) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s);",
            args,
        )
        return self.cur.lastrowid

    def file_edit(self, args):
        """Edit file. Args: [display_name, description, id]"""
        self.execute_non_query(f"UPDATE {self.config['db']['prefix']}_file SET display_name = %s, description = %s WHERE id = %s;", args)

    def file_delete(self, args):
        """Delete file by ID."""
        self.execute_non_query(f"DELETE FROM {self.config['db']['prefix']}_file WHERE id = %s;", args)

    def file_update_metadata(self, args):
        """Update file metadata. Args: [length_seconds, size_mb, id]"""
        self.execute_non_query(f"UPDATE {self.config['db']['prefix']}_file SET length_seconds = %s, size_mb = %s WHERE id = %s;", args)
    
    def file_ready(self, args):
        """Mark files as ready. Args: [id1, id2, ...]"""
        if not args:
            return
        placeholders = ', '.join(['%s'] * len(args))
        self.execute_non_query(f"UPDATE {self.config['db']['prefix']}_file SET ready = 1 WHERE id IN ({placeholders});", args)

    def file_view(self, args):
        """Mark file as viewed. Args: [viewed, id]"""
        self.execute_non_query(f"UPDATE {self.config['db']['prefix']}_file SET viewed = %s WHERE id = %s;", args)

    def file_note(self, args):
        """Update file note. Args: [note, id]"""
        self.execute_non_query(f"UPDATE {self.config['db']['prefix']}_file SET note = %s WHERE id = %s;", args)

    def file_move(self, args):
        """Move file to new path. Args: [new_path, id]"""
        self.execute_non_query(f"UPDATE {self.config['db']['prefix']}_file SET path = %s WHERE id = %s;", args)


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
    
    def _ensure_database_schema(self):
        """Initialize database schema and create default admin user if needed."""
        try:
            prefix = self.config['db']['prefix']
            
            # Create groups table
            self.execute_non_query(f"""
                CREATE TABLE IF NOT EXISTS {prefix}_group (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    name VARCHAR(255) NOT NULL UNIQUE,
                    description TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
            """)
            
            # Create users table
            self.execute_non_query(f"""
                CREATE TABLE IF NOT EXISTS {prefix}_user (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    login VARCHAR(255) NOT NULL UNIQUE,
                    name VARCHAR(255) NOT NULL,
                    password VARCHAR(255) NOT NULL,
                    gid INT NOT NULL DEFAULT 1,
                    enabled BOOLEAN DEFAULT TRUE,
                    permission TEXT NOT NULL DEFAULT '',
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    FOREIGN KEY (gid) REFERENCES {prefix}_group(id),
                    INDEX idx_login (login),
                    INDEX idx_enabled (enabled)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
            """)
            
            # Create files table with new structure
            self.execute_non_query(f"""
                CREATE TABLE IF NOT EXISTS {prefix}_file (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    display_name VARCHAR(255) NOT NULL,
                    real_name VARCHAR(255) NOT NULL,
                    path VARCHAR(500) NOT NULL,
                    owner VARCHAR(255) NOT NULL,
                    description TEXT DEFAULT '',
                    date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    ready TINYINT DEFAULT 0,
                    viewed TEXT DEFAULT '',
                    note TEXT DEFAULT '',
                    length_seconds INT DEFAULT 0,
                    size_mb DECIMAL(10,2) DEFAULT 0.00,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    INDEX idx_owner (owner),
                    INDEX idx_ready (ready),
                    INDEX idx_date (date),
                    INDEX idx_path (path(100))
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
            """)
            
            # Insert default admin group if not exists
            admin_group_name = self.config.get('admin', 'group', fallback='Администраторы')
            existing_group = self.execute_scalar(f"SELECT id FROM {prefix}_group WHERE name = %s LIMIT 1;", [admin_group_name])
            if not existing_group:
                self.execute_non_query(f"""
                    INSERT INTO {prefix}_group (name, description) 
                    VALUES (%s, 'Группа администраторов системы');
                """, [admin_group_name])
                _log.info(f"Created default admin group: {admin_group_name}")
            
            # Insert default admin user if not exists
            admin_login = 'admin'  # Fixed login name
            admin_name = self.config.get('admin', 'name', fallback='Administrator')
            admin_password_hash = self.config.get('admin', 'password', fallback='21232f297a57a5a743894a0e4a801fc3')
            # Create admin permissions for all 5 pages (hardcoded for now, 5 pages planned)
            admin_permissions = 'z,z,z,z,z'
            
            # Get group ID by name
            admin_group_result = self.execute_scalar(f"SELECT id FROM {prefix}_group WHERE name = %s LIMIT 1;", [admin_group_name])
            if admin_group_result:
                admin_group_id = admin_group_result[0]
            else:
                admin_group_id = 1  # fallback to first group
            
            existing_admin = self.execute_scalar(f"SELECT id FROM {prefix}_user WHERE login = %s LIMIT 1;", [admin_login])
            if not existing_admin:
                if admin_password_hash and admin_password_hash.strip():
                    self.execute_non_query(f"""
                        INSERT INTO {prefix}_user (login, name, password, gid, enabled, permission) 
                        VALUES (%s, %s, %s, %s, %s, %s);
                    """, [admin_login, admin_name, admin_password_hash, admin_group_id, True, admin_permissions])
                    _log.info(f"Created default admin user: {admin_login} in group: {admin_group_name}")
                else:
                    _log.error(f"Admin password hash is empty or invalid in config.ini, cannot create admin user")
            else:
                _log.info(f"Admin user {admin_login} already exists, skipping creation")
                
            _log.info("Database schema initialization completed successfully")
            
        except Exception as e:
            _log.error(f"Error initializing database schema: {str(e)}")
            raise

    # User management functions
    def user_all(self):
        """Get all users with their data."""
        from classes.user import User
        data = self.execute_query(f"SELECT id, login, name, password, gid, enabled, permission FROM {self.config['db']['prefix']}_user;")
        return [User(*d) for d in data] if data else None

    def user_by_id(self, args):
        """Get user by ID."""
        from classes.user import User
        data = self.execute_scalar(f"SELECT id, login, name, password, gid, enabled, permission FROM {self.config['db']['prefix']}_user WHERE id = %s;", args)
        return User(*data) if data else None

    def user_by_login(self, args):
        """Get user by login."""
        from classes.user import User
        data = self.execute_scalar(f"SELECT id, login, name, password, gid, enabled, permission FROM {self.config['db']['prefix']}_user WHERE login = %s;", args)
        return User(*data) if data else None

    def user_add(self, args):
        """Add new user. Args: [login, name, password, gid, enabled, permission]"""
        self.execute_non_query(f"INSERT INTO {self.config['db']['prefix']}_user (login, name, password, gid, enabled, permission) VALUES (%s, %s, %s, %s, %s, %s);", args)

    def user_edit(self, args):
        """Edit user. Args: [login, name, gid, enabled, permission, id]"""
        self.execute_non_query(f"UPDATE {self.config['db']['prefix']}_user SET login = %s, name = %s, gid = %s, enabled = %s, permission = %s WHERE id = %s;", args)

    def user_delete(self, args):
        """Delete user by ID."""
        self.execute_non_query(f"DELETE FROM {self.config['db']['prefix']}_user WHERE id = %s;", args)

    def user_toggle(self, args):
        """Toggle user enabled status. Args: [enabled, id]"""
        self.execute_non_query(f"UPDATE {self.config['db']['prefix']}_user SET enabled = %s WHERE id = %s;", args)

    def user_reset(self, args):
        """Reset user password. Args: [password_hash, id]"""
        self.execute_non_query(f"UPDATE {self.config['db']['prefix']}_user SET password = %s WHERE id = %s;", args)

    def user_exists(self, login, name, exclude_id=None):
        """Check if user with login or name already exists (case-insensitive)."""
        if exclude_id:
            data = self.execute_query(f"""
                SELECT id FROM {self.config['db']['prefix']}_user 
                WHERE (LOWER(login) = LOWER(%s) OR LOWER(name) = LOWER(%s)) AND id != %s
            """, [login, name, exclude_id])
        else:
            data = self.execute_query(f"""
                SELECT id FROM {self.config['db']['prefix']}_user 
                WHERE LOWER(login) = LOWER(%s) OR LOWER(name) = LOWER(%s)
            """, [login, name])
        return bool(data)

    # Group management functions
    def group_all(self):
        """Get all groups as {id: name} dictionary."""
        data = self.execute_query(f"SELECT id, name FROM {self.config['db']['prefix']}_group;")
        return {d[0]: d[1] for d in data} if data else None

    def group_by_id(self, args):
        """Get group by ID."""
        data = self.execute_scalar(f"SELECT id, name, description FROM {self.config['db']['prefix']}_group WHERE id = %s;", args)
        return data if data else None
