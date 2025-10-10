"""Database access layer with connection pooling and simple helpers."""

import mysql.connector as mysql
from mysql.connector import errors as mysql_errors

from classes.user import User
from classes.request import Request
from classes.file import File
from classes.order import Order
from classes.group import Group
from modules.core import Config
import base64
import secrets
from .logging import get_logger
import time

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

        # Create settings table for app-wide key/value storage (e.g., secret_key)
        self.execute_non_query(f"""CREATE TABLE IF NOT EXISTS {self.config['db']['prefix']}_settings (
    id INTEGER UNIQUE AUTO_INCREMENT,
    skey VARCHAR(255) NOT NULL UNIQUE,
    svalue TEXT NOT NULL,
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
            # Retry acquire to avoid immediate PoolError: pool exhausted under burst load
            retries = int(self.config['db'].get('pool_acquire_retries', 50))
            delay_ms = int(self.config['db'].get('pool_acquire_delay_ms', 200))
            last_err = None
            for _ in range(max(1, retries)):
                try:
                    self.conn = self._pool.get_connection()
                    break
                except mysql_errors.PoolError as e:
                    last_err = e
                    time.sleep(max(0, delay_ms) / 1000.0)
            else:
                # Exhausted retries
                raise last_err or mysql_errors.PoolError("Failed getting connection; pool exhausted")
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

    @with_conn
    def execute_insert(self, command, args=[]):
        """Execute INSERT and return last inserted id."""
        self.cur.execute(command, args)
        self.conn.commit()
        return self.cur.lastrowid


class SQLUtils(SQL):
    """High-level, typed helpers that map rows to domain objects."""

    def __init__(self):
        super().__init__()
        
        # Common SQL query fragments for optimization
        # Note: path is deprecated in DB; use category_id/subcategory_id/file_name. Keep legacy path for fallback.
        self._FILE_SELECT_FIELDS_CORE = "id, display_name, COALESCE(file_name, real_name) AS file_name, owner, description, date, ready, viewed, note, length_seconds, size_mb, order_id, category_id, subcategory_id, path"
        self._USER_SELECT_FIELDS = "id, login, name, password, gid, enabled, permission"
        self._GROUP_SELECT_FIELDS = "id, name, description"
        self._CATEGORY_SELECT_FIELDS = "id, display_name, folder_name, display_order, enabled"
        self._SUBCATEGORY_SELECT_FIELDS = "id, category_id, display_name, folder_name, display_order, enabled, user_view_own, user_view_group, user_view_all, user_edit_own, user_edit_group, user_edit_all, user_delete_own, user_delete_group, user_delete_all, group_view_own, group_view_group, group_view_all, group_edit_own, group_edit_group, group_edit_all, group_delete_own, group_delete_group, group_delete_all"

        # Ensure push subscriptions table exists with required columns and indexes
        try:
            prefix = self.config['db']['prefix']
            dbname = self.config['db']['name']
            self.execute_non_query(f"""
                CREATE TABLE IF NOT EXISTS {prefix}_push_sub (
	id INTEGER UNIQUE AUTO_INCREMENT,
                    user_id INT NOT NULL,
                    endpoint TEXT NOT NULL,
                    p256dh TEXT NOT NULL,
                    auth TEXT NOT NULL,
                    user_agent TEXT DEFAULT '',
                    last_success_at DATETIME NULL,
                    last_error_at DATETIME NULL,
                    last_checked_at DATETIME NULL,
                    error_code VARCHAR(32) DEFAULT NULL,
                    invalidated_at DATETIME NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
	PRIMARY KEY(id)
                );
            """)
            # Lower lock wait timeouts to avoid startup hangs when DDL locks are present
            try:
                self.execute_non_query("SET SESSION lock_wait_timeout = 3;")
            except Exception:
                pass
            try:
                self.execute_non_query("SET SESSION innodb_lock_wait_timeout = 3;")
            except Exception:
                pass
            # Add indexes and columns if missing (best-effort)
            try:
                self.execute_non_query(f"CREATE UNIQUE INDEX ux_{prefix}_push_sub_endpoint ON {prefix}_push_sub (endpoint(255));")
            except Exception:
                pass
            try:
                self.execute_non_query(f"CREATE INDEX ix_{prefix}_push_sub_user ON {prefix}_push_sub (user_id);")
            except Exception:
                pass
            # Columns that might be missing in older installs (check via INFORMATION_SCHEMA)
            for col, ddl in [
                ('user_agent', f"ALTER TABLE {prefix}_push_sub ADD COLUMN IF NOT EXISTS user_agent TEXT DEFAULT ''"),
                ('last_success_at', f"ALTER TABLE {prefix}_push_sub ADD COLUMN IF NOT EXISTS last_success_at DATETIME NULL"),
                ('last_error_at', f"ALTER TABLE {prefix}_push_sub ADD COLUMN IF NOT EXISTS last_error_at DATETIME NULL"),
                ('last_checked_at', f"ALTER TABLE {prefix}_push_sub ADD COLUMN IF NOT EXISTS last_checked_at DATETIME NULL"),
                ('error_code', f"ALTER TABLE {prefix}_push_sub ADD COLUMN IF NOT EXISTS error_code VARCHAR(32) NULL"),
                ('invalidated_at', f"ALTER TABLE {prefix}_push_sub ADD COLUMN IF NOT EXISTS invalidated_at DATETIME NULL"),
            ]:
                try:
                    exists = self.execute_scalar(
                        """
                        SELECT COUNT(1) FROM INFORMATION_SCHEMA.COLUMNS
                        WHERE TABLE_SCHEMA = %s AND TABLE_NAME = %s AND COLUMN_NAME = %s
                        LIMIT 1;
                        """,
                        [dbname, f"{prefix}_push_sub", col]
                    )
                    if not exists or int(exists[0]) == 0:
                        try:
                            self.execute_non_query(ddl)
                        except Exception:
                            # Fallback for servers without IF NOT EXISTS support
                            try:
                                self.execute_non_query(ddl.replace(" IF NOT EXISTS", ""))
                            except Exception:
                                pass
                except Exception:
                    pass
        except Exception:
            pass

    def permission_length(self):
        """Get the length of permission string from first user.
        
        Returns:
            int: Number of permission segments (pages)
        """
        data = self.execute_scalar(f"SELECT permission FROM {self.config['db']['prefix']}_user LIMIT 1;")
        return len(data[0].split(','))

    def get_or_create_secret_key(self) -> str:
        """Fetch application Flask secret key from DB; create if missing.

        Returns:
            str: secret key value
        """
        try:
            prefix = self.config['db']['prefix']
            # Ensure settings table exists (idempotent)
            self.execute_non_query(f"""
                CREATE TABLE IF NOT EXISTS {prefix}_settings (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    skey VARCHAR(255) NOT NULL UNIQUE,
                    svalue TEXT NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
            """)
            row = self.execute_scalar(f"SELECT svalue FROM {prefix}_settings WHERE skey = %s LIMIT 1;", ['secret_key'])
            if row and row[0]:
                return str(row[0])
            # Create a new strong secret key
            key = secrets.token_urlsafe(48)
            self.execute_non_query(f"INSERT INTO {prefix}_settings (skey, svalue) VALUES (%s, %s);", ['secret_key', key])
            return key
        except Exception:
            # As a last resort, generate a volatile key (process lifetime only)
            return secrets.token_urlsafe(48)

    def group_name_by_id(self, args):
        """Get group name by ID.
        
        Args:
            args: List containing group ID
            
        Returns:
            str: Group name
        """
        return self.execute_scalar(f"SELECT name FROM {self.config['db']['prefix']}_group WHERE id = %s;", args)[0]

    # --- Internal helpers for files ---
    def _ensure_files_new_columns(self):
        try:
            prefix = self.config['db']['prefix']
            dbname = self.config['db']['name']
            # Add new columns if missing
            for col, ddl in [
                ('category_id', f"ALTER TABLE {prefix}_file ADD COLUMN IF NOT EXISTS category_id INT NULL"),
                ('subcategory_id', f"ALTER TABLE {prefix}_file ADD COLUMN IF NOT EXISTS subcategory_id INT NULL"),
                ('file_name', f"ALTER TABLE {prefix}_file ADD COLUMN IF NOT EXISTS file_name VARCHAR(255) NULL")
            ]:
                try:
                    exists = self.execute_scalar(
                        """
                        SELECT COUNT(1) FROM INFORMATION_SCHEMA.COLUMNS
                        WHERE TABLE_SCHEMA = %s AND TABLE_NAME = %s AND COLUMN_NAME = %s
                        LIMIT 1;
                        """,
                        [dbname, f"{prefix}_file", col]
                    )
                    if not exists or int(exists[0]) == 0:
                        try:
                            self.execute_non_query(ddl)
                        except Exception:
                            self.execute_non_query(ddl.replace(" IF NOT EXISTS", ""))
                except Exception:
                    pass
            # Indexes for fast lookups
            try:
                self.execute_non_query(f"CREATE INDEX ix_{prefix}_file_cat_sub ON {prefix}_file (category_id, subcategory_id);")
            except Exception:
                pass
            try:
                self.execute_non_query(f"CREATE INDEX ix_{prefix}_file_fname ON {prefix}_file (file_name);")
            except Exception:
                pass
            # Backfill legacy rows into new columns (best-effort)
            try:
                rows = self.execute_query(
                    f"SELECT id, path, real_name, category_id, subcategory_id, file_name FROM {prefix}_file WHERE (category_id IS NULL OR subcategory_id IS NULL OR file_name IS NULL);"
                )
                import os
                for r in rows or []:
                    fid, fpath, real_name, cat_id, sub_id, fname = r
                    # compute file_name
                    fname_new = fname or real_name
                    # try parse .../video/<cat>/<sub>
                    try:
                        parts = os.path.normpath(fpath or '').split(os.sep)
                        cat_folder = parts[-2] if len(parts) >= 2 else None
                        sub_folder = parts[-1] if len(parts) >= 1 else None
                        new_cat_id = cat_id or (self.category_id_by_folder(cat_folder) if cat_folder else None)
                        new_sub_id = sub_id or (self.subcategory_id_by_folder(new_cat_id, sub_folder) if (new_cat_id and sub_folder) else None)
                    except Exception:
                        new_cat_id, new_sub_id = cat_id, sub_id
                    # Apply update when we have something to set
                    try:
                        self.execute_non_query(
                            f"UPDATE {prefix}_file SET category_id = COALESCE(%s, category_id), subcategory_id = COALESCE(%s, subcategory_id), file_name = COALESCE(%s, file_name) WHERE id = %s;",
                            [new_cat_id, new_sub_id, fname_new, fid]
                        )
                    except Exception:
                        pass
            except Exception:
                pass
        except Exception:
            pass

    def _get_category_folder_by_id(self, category_id: int) -> str:
        row = self.execute_scalar(
            f"SELECT folder_name FROM {self.config['db']['prefix']}_file_category WHERE id = %s LIMIT 1;",
            [category_id]
        )
        return row[0] if row else ''

    def _get_subcategory_folder_by_id(self, subcategory_id: int) -> str:
        row = self.execute_scalar(
            f"SELECT folder_name FROM {self.config['db']['prefix']}_file_subcategory WHERE id = %s LIMIT 1;",
            [subcategory_id]
        )
        return row[0] if row else ''

    def _build_storage_dir(self, category_id: int, subcategory_id: int) -> str:
        try:
            base = self.config['files']['root']
            cat_folder = self._get_category_folder_by_id(category_id)
            sub_folder = self._get_subcategory_folder_by_id(subcategory_id)
            import os
            return os.path.join(base, 'video', cat_folder, sub_folder)
        except Exception:
            import os
            return os.path.join(self.config['files'].get('root', '/var/lib/znv-files'), 'video')

    def get_file_storage_path(self, category_id: int, subcategory_id: int) -> str:
        """Public helper to compute absolute directory for given category/subcategory ids."""
        try:
            return self._build_storage_dir(int(category_id or 0), int(subcategory_id or 0))
        except Exception:
            return self._build_storage_dir(0, 0)

    def category_id_by_folder(self, folder_name: str):
        row = self.execute_scalar(
            f"SELECT id FROM {self.config['db']['prefix']}_file_category WHERE folder_name = %s LIMIT 1;",
            [folder_name]
        )
        return int(row[0]) if row else None

    def subcategory_id_by_folder(self, category_id: int, folder_name: str):
        row = self.execute_scalar(
            f"SELECT id FROM {self.config['db']['prefix']}_file_subcategory WHERE category_id = %s AND folder_name = %s LIMIT 1;",
            [category_id, folder_name]
        )
        return int(row[0]) if row else None

    # File management functions
    def file_by_id(self, args):
        """Get file by ID.
        
        Args:
            args: List containing file ID
            
        Returns:
            File object or None if not found
        """
        self._ensure_files_new_columns()
        from classes.file import File
        row = self.execute_scalar(
            f"SELECT {self._FILE_SELECT_FIELDS_CORE} FROM {self.config['db']['prefix']}_file WHERE id = %s;",
            args
        )
        if not row:
            return None
        (
            fid, display_name, file_name, owner, description, date, ready, viewed, note, length_seconds, size_mb, order_id, category_id, subcategory_id, legacy_path
        ) = row
        storage_dir = self._build_storage_dir(category_id or 0, subcategory_id or 0) or (legacy_path or '')
        return File(fid, display_name, file_name, storage_dir, owner, description, date, ready, viewed, note, length_seconds, size_mb, order_id)

    def file_by_path(self, args):
        """Backward-compatible: resolve by absolute directory path, then fetch by category/subcategory.
        Args: [abs_dir_path]
        """
        self._ensure_files_new_columns()
        try:
            import os
            abs_dir = args[0]
            parts = os.path.normpath(abs_dir).split(os.sep)
            # Expect .../<root>/video/<cat>/<sub>
            cat_folder = parts[-2] if len(parts) >= 2 else ''
            sub_folder = parts[-1] if len(parts) >= 1 else ''
            cat_id = self.category_id_by_folder(cat_folder)
            sub_id = self.subcategory_id_by_folder(cat_id or 0, sub_folder) if cat_id else None
            if not cat_id or not sub_id:
                return []
            rows = self.execute_query(
                f"SELECT {self._FILE_SELECT_FIELDS_CORE} FROM {self.config['db']['prefix']}_file WHERE category_id = %s AND subcategory_id = %s;",
                [cat_id, sub_id]
            )
            from classes.file import File
            storage_dir = self._build_storage_dir(cat_id, sub_id)
            files = []
            for r in rows or []:
                (fid, display_name, file_name, owner, description, date, ready, viewed, note, length_seconds, size_mb, order_id, category_id, subcategory_id, legacy_path) = r
                files.append(File(fid, display_name, file_name, storage_dir or (legacy_path or ''), owner, description, date, ready, viewed, note, length_seconds, size_mb, order_id))
            return files
        except Exception:
            return []

    def file_by_category_and_subcategory(self, args):
        """Fetch files by category_id and subcategory_id using new schema.
        Args: [category_id, subcategory_id]
        Returns: list[File]
        """
        self._ensure_files_new_columns()
        try:
            cat_id, sub_id = int(args[0]), int(args[1])
        except Exception:
            return []
        rows = self.execute_query(
            f"SELECT {self._FILE_SELECT_FIELDS_CORE} FROM {self.config['db']['prefix']}_file WHERE category_id = %s AND subcategory_id = %s;",
            [cat_id, sub_id]
        )
        from classes.file import File
        storage_dir = self._build_storage_dir(cat_id, sub_id)
        files = []
        for r in rows or []:
            (fid, display_name, file_name, owner, description, date, ready, viewed, note, length_seconds, size_mb, order_id, category_id, subcategory_id, legacy_path) = r
            files.append(File(fid, display_name, file_name, storage_dir or (legacy_path or ''), owner, description, date, ready, viewed, note, length_seconds, size_mb, order_id))
        return files

    def file_all(self):
        """Get all files.
        
        Returns:
            List of File objects or None if no files found
        """
        self._ensure_files_new_columns()
        rows = self.execute_query(f"SELECT {self._FILE_SELECT_FIELDS_CORE} FROM {self.config['db']['prefix']}_file;")
        from classes.file import File
        result = []
        for r in rows or []:
            (fid, display_name, file_name, owner, description, date, ready, viewed, note, length_seconds, size_mb, order_id, category_id, subcategory_id, legacy_path) = r
            storage_dir = self._build_storage_dir(category_id or 0, subcategory_id or 0) or (legacy_path or '')
            result.append(File(fid, display_name, file_name, storage_dir, owner, description, date, ready, viewed, note, length_seconds, size_mb, order_id))
        return result

    def file_add(self, args):
        """Deprecated signature kept for compatibility: will map to new columns.
        Args: [display_name, real_name, path, owner, description, date, ready, length_seconds, size_mb, order_id]
        """
        # Try to infer category/subcategory from path
        try:
            import os
            _, _, cat_folder, sub_folder = os.path.normpath(args[2]).rsplit(os.sep, 3)
        except Exception:
            cat_folder, sub_folder = None, None
        cat_id = self.category_id_by_folder(cat_folder) if cat_folder else None
        sub_id = self.subcategory_id_by_folder(cat_id or 0, sub_folder) if (cat_id and sub_folder) else None
        return self.file_add2([
            args[0],               # display_name
            args[1],               # file_name
            cat_id, sub_id,
            args[3],               # owner
            args[4],               # description
            args[5],               # date
            args[6],               # ready
            args[7],               # length_seconds
            args[8],               # size_mb
            args[9] if len(args) > 9 else None  # order_id
        ])

    def file_add2(self, args):
        """Add new file with new schema.
        Args: [display_name, file_name, category_id, subcategory_id, owner, description, date, ready, length_seconds, size_mb, order_id]
        """
        self._ensure_files_new_columns()
        return self.execute_insert(
            f"INSERT INTO {self.config['db']['prefix']}_file (display_name, file_name, category_id, subcategory_id, owner, description, date, ready, length_seconds, size_mb, order_id) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s);",
            args,
        )

    def file_edit(self, args):
        """Edit file. Args: [display_name, description, id]"""
        self.execute_non_query(f"UPDATE {self.config['db']['prefix']}_file SET display_name = %s, description = %s WHERE id = %s;", args)

    def file_set_order_id(self, args):
        """Set order_id for file. Args: [order_id, file_id]"""
        self.execute_non_query(f"UPDATE {self.config['db']['prefix']}_file SET order_id = %s WHERE id = %s;", args)

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

    def file_update_real_name(self, args):
        """Update stored filename after conversion. Args: [real_name, id]
        Keeps both legacy real_name and new file_name in sync.
        """
        try:
            # Update both columns if file_name exists
            self.execute_non_query(
                f"UPDATE {self.config['db']['prefix']}_file SET real_name = %s, file_name = %s WHERE id = %s;",
                [args[0], args[0], args[1]]
            )
        except Exception:
            # Fallback for older schemas without file_name
            self.execute_non_query(f"UPDATE {self.config['db']['prefix']}_file SET real_name = %s WHERE id = %s;", args)

    def file_view(self, args):
        """Mark file as viewed. Args: [viewed, id]"""
        self.execute_non_query(f"UPDATE {self.config['db']['prefix']}_file SET viewed = %s WHERE id = %s;", args)

    def file_note(self, args):
        """Update file note. Args: [note, id]"""
        self.execute_non_query(f"UPDATE {self.config['db']['prefix']}_file SET note = %s WHERE id = %s;", args)

    def file_move(self, args):
        """Deprecated: update path (no-op for new schema)."""
        try:
            # Attempt to infer and update new columns too
            import os
            _, _, cat_folder, sub_folder = os.path.normpath(args[0]).rsplit(os.sep, 3)
            cat_id = self.category_id_by_folder(cat_folder)
            sub_id = self.subcategory_id_by_folder(int(cat_id), sub_folder) if cat_id is not None else None
            self.execute_non_query(f"UPDATE {self.config['db']['prefix']}_file SET category_id = %s, subcategory_id = %s WHERE id = %s;", [cat_id, sub_id, args[1]])
        except Exception:
            pass

    def file_move_to_subcategory(self, args):
        """Move file to another subcategory. Args: [category_id, subcategory_id, id]"""
        self.execute_non_query(f"UPDATE {self.config['db']['prefix']}_file SET category_id = %s, subcategory_id = %s WHERE id = %s;", args)


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
        data = self.execute_query(f'SELECT * FROM {self.config["db"]["prefix"]}_order WHERE DATE(start_date) <= STR_TO_DATE(%s, "%Y-%m-%d") AND DATE(end_date) >= STR_TO_DATE(%s, "%Y-%m-%d") AND state < 1;', [date, date])
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
                    order_id INT NULL DEFAULT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    INDEX idx_owner (owner),
                    INDEX idx_ready (ready),
                    INDEX idx_date (date),
                    INDEX idx_path (path(100)),
                    INDEX idx_order_id (order_id)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
            """)

            # Create push subscriptions table (for browser notifications)
            self.execute_non_query(f"""
                CREATE TABLE IF NOT EXISTS {prefix}_push_sub (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    user_id INT NOT NULL,
                    endpoint TEXT NOT NULL,
                    p256dh VARCHAR(255) DEFAULT '',
                    auth VARCHAR(255) DEFAULT '',
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE KEY uniq_endpoint (endpoint(191)),
                    INDEX idx_user (user_id),
                    FOREIGN KEY (user_id) REFERENCES {prefix}_user(id) ON DELETE CASCADE
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
            """)

            # Create settings table for app-wide key/value settings (e.g., VAPID keys)
            self.execute_non_query(f"""
                CREATE TABLE IF NOT EXISTS {prefix}_setting (
                    name VARCHAR(64) PRIMARY KEY,
                    value TEXT NOT NULL,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
            """)

            # Create file categories table
            self.execute_non_query(f"""
                CREATE TABLE IF NOT EXISTS {prefix}_file_category (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    display_name VARCHAR(255) NOT NULL,
                    folder_name VARCHAR(255) NOT NULL UNIQUE,
                    display_order INT DEFAULT 0,
                    enabled TINYINT DEFAULT 1,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    INDEX idx_display_order (display_order),
                    INDEX idx_enabled (enabled)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
            """)

            # Create file subcategories table with permissions
            self.execute_non_query(f"""
                CREATE TABLE IF NOT EXISTS {prefix}_file_subcategory (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    category_id INT NOT NULL,
                    display_name VARCHAR(255) NOT NULL,
                    folder_name VARCHAR(255) NOT NULL,
                    display_order INT DEFAULT 0,
                    enabled TINYINT DEFAULT 1,
                    -- Permissions: view, edit, delete for users, groups, all
                    user_view_own TINYINT DEFAULT 0,
                    user_view_group TINYINT DEFAULT 0,
                    user_view_all TINYINT DEFAULT 0,
                    user_edit_own TINYINT DEFAULT 0,
                    user_edit_group TINYINT DEFAULT 0,
                    user_edit_all TINYINT DEFAULT 0,
                    user_delete_own TINYINT DEFAULT 0,
                    user_delete_group TINYINT DEFAULT 0,
                    user_delete_all TINYINT DEFAULT 0,
                    group_view_own TINYINT DEFAULT 0,
                    group_view_group TINYINT DEFAULT 0,
                    group_view_all TINYINT DEFAULT 0,
                    group_edit_own TINYINT DEFAULT 0,
                    group_edit_group TINYINT DEFAULT 0,
                    group_edit_all TINYINT DEFAULT 0,
                    group_delete_own TINYINT DEFAULT 0,
                    group_delete_group TINYINT DEFAULT 0,
                    group_delete_all TINYINT DEFAULT 0,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    UNIQUE KEY uniq_category_folder (category_id, folder_name),
                    INDEX idx_category (category_id),
                    INDEX idx_display_order (display_order),
                    INDEX idx_enabled (enabled),
                    FOREIGN KEY (category_id) REFERENCES {prefix}_file_category(id) ON DELETE CASCADE
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
            """)
            
            # Insert default admin group if not exists
            admin_group_name = self.config.get('admin', 'group', fallback='Администраторы')
            admin_group_result = self.execute_scalar(f"SELECT id FROM {prefix}_group WHERE LOWER(name) = LOWER(%s) LIMIT 1;", [admin_group_name])
            if not admin_group_result:
                self.execute_non_query(f"""
                    INSERT INTO {prefix}_group (name, description) 
                    VALUES (%s, 'Группа администраторов системы');
                """, [admin_group_name])
                _log.info(f"Created default admin group: {admin_group_name}")
                admin_group_id = 1  # New group will have ID 1
            else:
                admin_group_id = admin_group_result[0]
            
            # Insert default admin user if not exists
            admin_login = 'admin'  # Fixed login name
            admin_name = self.config.get('admin', 'name', fallback='Administrator')
            admin_password_hash = self.config.get('admin', 'password', fallback='21232f297a57a5a743894a0e4a801fc3')
            # Create admin permissions for all 5 pages (hardcoded for now, 5 pages planned)
            admin_permissions = 'z,z,z,z,z'
            
            existing_admin = self.execute_scalar(f"SELECT id FROM {prefix}_user WHERE LOWER(login) = LOWER(%s) LIMIT 1;", [admin_login])
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

            # Ensure VAPID keys exist in settings; generate if missing/empty
            try:
                pub = self.push_get_vapid_public()
                priv = self.push_get_vapid_private()
                subj = self.push_get_vapid_subject()
                if not pub or not priv:
                    try:
                        from cryptography.hazmat.primitives.asymmetric import ec
                        from cryptography.hazmat.primitives import serialization
                    except Exception as e:
                        _log.error(f"Cannot generate VAPID keys: cryptography not installed: {e}")
                        raise
                    private_key = ec.generate_private_key(ec.SECP256R1())
                    private_value = private_key.private_numbers().private_value.to_bytes(32, 'big')
                    public_key = private_key.public_key()
                    public_numbers = public_key.public_numbers()
                    x = public_numbers.x.to_bytes(32, 'big')
                    y = public_numbers.y.to_bytes(32, 'big')
                    uncompressed = b"\x04" + x + y
                    def b64u(data: bytes) -> str:
                        return base64.urlsafe_b64encode(data).decode('ascii').rstrip('=')
                    vapid_public = b64u(uncompressed)
                    vapid_private = b64u(private_value)
                    self.push_set_vapid_keys(vapid_public, vapid_private, subj or 'mailto:admin@example.com')
                    _log.info("Generated and stored VAPID keys in DB settings")
            except Exception as e:
                _log.error(f"Error ensuring VAPID keys: {e}")
            
        except Exception as e:
            _log.error(f"Error initializing database schema: {str(e)}")
            raise

    # User management functions
    def user_all(self):
        """Get all users with their data.
        
        Returns:
            List of User objects or None if no users found
        """
        from classes.user import User
        data = self.execute_query(f"SELECT {self._USER_SELECT_FIELDS} FROM {self.config['db']['prefix']}_user;")
        return [User(*d) for d in data] if data else None

    def user_by_id(self, args):
        """Get user by ID.
        
        Args:
            args: List containing user ID
            
        Returns:
            User object or None if not found
        """
        from classes.user import User
        data = self.execute_scalar(f"SELECT {self._USER_SELECT_FIELDS} FROM {self.config['db']['prefix']}_user WHERE id = %s;", args)
        return User(*data) if data else None

    def user_by_login(self, args):
        """Get user by login (case-insensitive).
        
        Args:
            args: List containing user login
            
        Returns:
            User object or None if not found
        """
        from classes.user import User
        data = self.execute_scalar(f"SELECT {self._USER_SELECT_FIELDS} FROM {self.config['db']['prefix']}_user WHERE LOWER(login) = LOWER(%s);", args)
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
        """Check if user with login or name already exists (case-insensitive).
        
        Args:
            login: User login to check
            name: User name to check
            exclude_id: Optional user ID to exclude from check (for updates)
            
        Returns:
            bool: True if user exists, False otherwise
        """
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
        """Get all groups as {id: name} dictionary.
        
        Returns:
            dict: Dictionary mapping group IDs to names, or None if no groups found
        """
        data = self.execute_query(f"SELECT id, name FROM {self.config['db']['prefix']}_group;")
        return {d[0]: d[1] for d in data} if data else None

    def group_all_full(self):
        """Get all groups as list of tuples.
        
        Returns:
            list: List of (id, name, description) tuples, or None if no groups found
        """
        data = self.execute_query(f"SELECT {self._GROUP_SELECT_FIELDS} FROM {self.config['db']['prefix']}_group;")
        return data if data else None

    def group_by_id(self, args):
        """Get group by ID.
        
        Args:
            args: List containing group ID
            
        Returns:
            tuple: (id, name, description) or None if not found
        """
        data = self.execute_scalar(f"SELECT {self._GROUP_SELECT_FIELDS} FROM {self.config['db']['prefix']}_group WHERE id = %s;", args)
        return data if data else None

    def group_add(self, args):
        """Add new group.
        
        Args:
            args: List containing [name, description]
            
        Returns:
            int: ID of the created group
        """
        return self.execute_insert(f"INSERT INTO {self.config['db']['prefix']}_group (name, description) VALUES (%s, %s);", args)

    def group_edit(self, args):
        """Edit group.
        
        Args:
            args: List containing [name, description, id]
        """
        return self.execute_non_query(f"UPDATE {self.config['db']['prefix']}_group SET name = %s, description = %s WHERE id = %s;", args)

    def group_delete(self, args):
        """Delete group.
        
        Args:
            args: List containing group ID
        """
        return self.execute_non_query(f"DELETE FROM {self.config['db']['prefix']}_group WHERE id = %s;", args)

    def group_exists(self, args):
        """Check if group exists by name (case-insensitive).
        
        Args:
            args: List containing group name
            
        Returns:
            bool: True if group exists, False otherwise
        """
        data = self.execute_scalar(f"SELECT id FROM {self.config['db']['prefix']}_group WHERE LOWER(name) = LOWER(%s);", args)
        return bool(data)

    def group_exists_except(self, args):
        """Check if group exists by name excluding specific ID (case-insensitive).
        
        Args:
            args: List containing [name, exclude_id]
            
        Returns:
            bool: True if group exists with different ID, False otherwise
        """
        data = self.execute_scalar(f"SELECT id FROM {self.config['db']['prefix']}_group WHERE LOWER(name) = LOWER(%s) AND id != %s;", args)
        return bool(data)

    def group_get_all_objects(self):
        """Get all groups as Group objects.
        
        Returns:
            list: List of Group objects, ordered by name
        """
        # Select only columns guaranteed to exist across schemas.
        # 'updated_at' may be absent in some installations.
        data = self.execute_query(f"SELECT {self._GROUP_SELECT_FIELDS}, created_at FROM {self.config['db']['prefix']}_group ORDER BY name;")
        return [Group(*d) for d in data] if data else []

    # --- Push subscriptions ---
    def push_add_subscription(self, user_id: int, endpoint: str, p256dh: str, auth: str):
        """Store or update a push subscription for a user."""
        # Try update existing by endpoint; if none, insert
        existing = self.execute_scalar(
            f"SELECT id FROM {self.config['db']['prefix']}_push_sub WHERE endpoint = %s;",
            [endpoint]
        )
        if existing:
            return self.execute_non_query(
                f"UPDATE {self.config['db']['prefix']}_push_sub SET user_id = %s, p256dh = %s, auth = %s, user_agent = %s, last_checked_at = NOW(), last_error_at = NULL, error_code = NULL, invalidated_at = NULL WHERE id = %s;",
                [user_id, p256dh, auth, (self.config.get('user_agent') or ''), existing[0]]
            )
        return self.execute_insert(
            f"INSERT INTO {self.config['db']['prefix']}_push_sub (user_id, endpoint, p256dh, auth, user_agent, last_checked_at) VALUES (%s, %s, %s, %s, %s, NOW());",
            [user_id, endpoint, p256dh, auth, (self.config.get('user_agent') or '')]
        )

    def push_remove_subscription(self, endpoint: str):
        """Remove a push subscription by endpoint."""
        return self.execute_non_query(
            f"DELETE FROM {self.config['db']['prefix']}_push_sub WHERE endpoint = %s;",
            [endpoint]
        )

    def push_get_user_subscriptions(self, user_id: int):
        """Get all push subscriptions for a user."""
        return self.execute_query(
            f"SELECT id, endpoint, p256dh, auth, created_at FROM {self.config['db']['prefix']}_push_sub WHERE user_id = %s;",
            [user_id]
        )

    def push_mark_success(self, endpoint: str):
        try:
            return self.execute_non_query(
                f"UPDATE {self.config['db']['prefix']}_push_sub SET last_success_at = NOW(), last_checked_at = NOW(), last_error_at = NULL, error_code = NULL WHERE endpoint = %s;",
                [endpoint]
            )
        except Exception:
            return None

    def push_mark_error(self, endpoint: str, code: str = None):
        try:
            return self.execute_non_query(
                f"UPDATE {self.config['db']['prefix']}_push_sub SET last_error_at = NOW(), last_checked_at = NOW(), error_code = %s WHERE endpoint = %s;",
                [str(code) if code else None, endpoint]
            )
        except Exception:
            return None

    # --- App settings (VAPID keys storage) ---
    def setting_get(self, name: str):
        row = self.execute_scalar(
            f"SELECT value FROM {self.config['db']['prefix']}_setting WHERE name = %s LIMIT 1;",
            [name]
        )
        return row[0] if row else None

    def setting_set(self, name: str, value: str):
        return self.execute_non_query(
            f"INSERT INTO {self.config['db']['prefix']}_setting (name, value) VALUES (%s, %s) ON DUPLICATE KEY UPDATE value = VALUES(value);",
            [name, value]
        )

    def push_get_vapid_public(self):
        val = self.setting_get('vapid_public')
        return val.strip() if isinstance(val, str) else None

    def push_get_vapid_private(self):
        val = self.setting_get('vapid_private')
        return val.strip() if isinstance(val, str) else None

    def push_get_vapid_subject(self):
        val = self.setting_get('vapid_subject')
        return (val.strip() if isinstance(val, str) else None) or 'mailto:admin@example.com'

    def push_set_vapid_keys(self, public_key: str, private_key: str, subject: str = 'mailto:admin@example.com'):
        self.setting_set('vapid_public', public_key or '')
        self.setting_set('vapid_private', private_key or '')
        self.setting_set('vapid_subject', subject or 'mailto:admin@example.com')

    # --- Flask secret key management ---
    def get_flask_secret_key(self):
        val = self.setting_get('flask_secret_key')
        return val if isinstance(val, str) and val.strip() else None

    def set_flask_secret_key(self, value: str):
        return self.setting_set('flask_secret_key', value)

    def ensure_and_get_flask_secret_key(self):
        key = self.get_flask_secret_key()
        if key:
            return key
        # Generate a strong URL-safe secret key
        key = secrets.token_urlsafe(64)
        self.set_flask_secret_key(key)
        _log.info("Generated and stored Flask secret key in DB settings")
        return key

    # --- File Categories ---
    def category_all(self):
        """Get all categories ordered by display_order."""
        from classes.category import Category
        data = self.execute_query(f"SELECT {self._CATEGORY_SELECT_FIELDS} FROM {self.config['db']['prefix']}_file_category ORDER BY display_order, id;")
        return [Category(*d) for d in data] if data else []

    def category_by_id(self, args):
        """Get category by ID."""
        from classes.category import Category
        data = self.execute_scalar(f"SELECT {self._CATEGORY_SELECT_FIELDS} FROM {self.config['db']['prefix']}_file_category WHERE id = %s;", args)
        return Category(*data) if data else None

    def category_add(self, args):
        """Add new category. Args: [display_name, folder_name, display_order, enabled]"""
        return self.execute_insert(
            f"INSERT INTO {self.config['db']['prefix']}_file_category (display_name, folder_name, display_order, enabled) VALUES (%s, %s, %s, %s);",
            args
        )

    def category_edit(self, args):
        """Edit category. Args: [display_name, folder_name, display_order, enabled, id]"""
        self.execute_non_query(
            f"UPDATE {self.config['db']['prefix']}_file_category SET display_name = %s, folder_name = %s, display_order = %s, enabled = %s WHERE id = %s;",
            args
        )

    def category_delete(self, args):
        """Delete category by ID."""
        self.execute_non_query(f"DELETE FROM {self.config['db']['prefix']}_file_category WHERE id = %s;", args)

    def category_exists(self, args):
        """Check if category exists by folder_name. Args: [folder_name]"""
        data = self.execute_scalar(f"SELECT id FROM {self.config['db']['prefix']}_file_category WHERE folder_name = %s;", args)
        return bool(data)

    def category_exists_except(self, args):
        """Check if category exists with different ID. Args: [folder_name, id]"""
        data = self.execute_scalar(f"SELECT id FROM {self.config['db']['prefix']}_file_category WHERE folder_name = %s AND id != %s;", args)
        return bool(data)

    def category_name_exists_ci(self, args):
        """Case-insensitive check if category exists by display_name. Args: [display_name]"""
        data = self.execute_scalar(
            f"SELECT id FROM {self.config['db']['prefix']}_file_category WHERE LOWER(display_name) = LOWER(%s) LIMIT 1;",
            args
        )
        return bool(data)

    def category_name_exists_except_ci(self, args):
        """Case-insensitive check if category display_name exists excluding specific ID. Args: [display_name, id]"""
        data = self.execute_scalar(
            f"SELECT id FROM {self.config['db']['prefix']}_file_category WHERE LOWER(display_name) = LOWER(%s) AND id != %s LIMIT 1;",
            args
        )
        return bool(data)

    # --- File Subcategories ---
    def subcategory_all(self):
        """Get all subcategories ordered by category_id, display_order."""
        from classes.subcategory import Subcategory
        data = self.execute_query(f"SELECT {self._SUBCATEGORY_SELECT_FIELDS} FROM {self.config['db']['prefix']}_file_subcategory ORDER BY category_id, display_order, id;")
        return [Subcategory(*d) for d in data] if data else []

    def subcategory_by_category(self, args):
        """Get subcategories by category ID."""
        from classes.subcategory import Subcategory
        data = self.execute_query(f"SELECT {self._SUBCATEGORY_SELECT_FIELDS} FROM {self.config['db']['prefix']}_file_subcategory WHERE category_id = %s ORDER BY display_order, id;", args)
        return [Subcategory(*d) for d in data] if data else []

    def subcategory_by_id(self, args):
        """Get subcategory by ID."""
        from classes.subcategory import Subcategory
        data = self.execute_scalar(f"SELECT {self._SUBCATEGORY_SELECT_FIELDS} FROM {self.config['db']['prefix']}_file_subcategory WHERE id = %s;", args)
        return Subcategory(*data) if data else None

    def subcategory_basic_by_id(self, args):
        """Get subcategory core fields by ID (compatible with older schemas)."""
        from classes.subcategory import Subcategory
        data = self.execute_scalar(
            f"SELECT id, category_id, display_name, folder_name, display_order, enabled FROM {self.config['db']['prefix']}_file_subcategory WHERE id = %s;",
            args
        )
        return Subcategory(*data) if data else None

    def subcategory_add(self, args):
        """Add new subcategory. Args: [category_id, display_name, folder_name, display_order, enabled]"""
        return self.execute_insert(
            f"INSERT INTO {self.config['db']['prefix']}_file_subcategory (category_id, display_name, folder_name, display_order, enabled) VALUES (%s, %s, %s, %s, %s);",
            args
        )

    def subcategory_edit(self, args):
        """Edit subcategory. Args: [category_id, display_name, folder_name, display_order, enabled, user_view_own, user_view_group, user_view_all, user_edit_own, user_edit_group, user_edit_all, user_delete_own, user_delete_group, user_delete_all, group_view_own, group_view_group, group_view_all, group_edit_own, group_edit_group, group_edit_all, group_delete_own, group_delete_group, group_delete_all, id]"""
        self.execute_non_query(
            f"UPDATE {self.config['db']['prefix']}_file_subcategory SET category_id = %s, display_name = %s, folder_name = %s, display_order = %s, enabled = %s, user_view_own = %s, user_view_group = %s, user_view_all = %s, user_edit_own = %s, user_edit_group = %s, user_edit_all = %s, user_delete_own = %s, user_delete_group = %s, user_delete_all = %s, group_view_own = %s, group_view_group = %s, group_view_all = %s, group_edit_own = %s, group_edit_group = %s, group_edit_all = %s, group_delete_own = %s, group_delete_group = %s, group_delete_all = %s WHERE id = %s;",
            args
        )

    def subcategory_delete(self, args):
        """Delete subcategory by ID."""
        self.execute_non_query(f"DELETE FROM {self.config['db']['prefix']}_file_subcategory WHERE id = %s;", args)

    def subcategory_exists(self, args):
        """Check if subcategory exists by category_id and folder_name. Args: [category_id, folder_name]"""
        data = self.execute_scalar(f"SELECT id FROM {self.config['db']['prefix']}_file_subcategory WHERE category_id = %s AND folder_name = %s;", args)
        return bool(data)

    def subcategory_exists_except(self, args):
        """Check if subcategory exists with different ID. Args: [category_id, folder_name, id]"""
        data = self.execute_scalar(f"SELECT id FROM {self.config['db']['prefix']}_file_subcategory WHERE category_id = %s AND folder_name = %s AND id != %s;", args)
        return bool(data)

    def subcategory_count_by_category(self, args):
        """Count subcategories in a category. Args: [category_id] -> int"""
        row = self.execute_scalar(
            f"SELECT COUNT(1) FROM {self.config['db']['prefix']}_file_subcategory WHERE category_id = %s;",
            args
        )
        return int(row[0]) if row else 0

    def subcategory_enabled_count_by_category(self, args):
        """Count enabled subcategories in a category. Args: [category_id] -> int"""
        row = self.execute_scalar(
            f"SELECT COUNT(1) FROM {self.config['db']['prefix']}_file_subcategory WHERE category_id = %s AND enabled = 1;",
            args
        )
        return int(row[0]) if row else 0

    def files_count_in_subcategory(self, args):
        """Count files by subcategory id using new schema. Args: [subcategory_id] -> int"""
        sub_id = int(args[0])
        row_cnt = self.execute_scalar(
            f"SELECT COUNT(1) FROM {self.config['db']['prefix']}_file WHERE subcategory_id = %s;",
            [sub_id]
        )
        return int(row_cnt[0]) if row_cnt else 0
