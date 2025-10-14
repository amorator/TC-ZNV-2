"""
Group class for managing user groups
"""

from flask_login import UserMixin


class Group:
	"""Group class representing a user group with permissions and metadata."""
	
	def __init__(self, id, name, description='', created_at=None, updated_at=None):
		self.id = id
		self.name = name
		self.description = description
		self.created_at = created_at
		self.updated_at = updated_at
	
	def __repr__(self):
		return f"<Group {self.id}: {self.name}>"
	
	def to_dict(self):
		"""Convert group to dictionary for JSON serialization."""
		return {
			'id': self.id,
			'name': self.name,
			'description': self.description,
			'created_at': self.created_at,
			'updated_at': self.updated_at
		}
	
	@property
	def display_name(self):
		"""Get display name for the group."""
		return self.name
	
	def is_system_group(self, admin_group_name=None):
		"""Check if this is a system group (like admin group)."""
		if self.id == 1:
			return True
		if admin_group_name and self.name.lower() == admin_group_name.lower():
			return True
		return self.name.lower() in ['admin', 'администраторы', 'программисты']
	
	def can_be_deleted(self):
		"""Check if this group can be deleted (not system group and no users)."""
		return not self.is_system_group()
	
	def get_user_count(self, sql_utils):
		"""Get the number of users in this group."""
		try:
			data = sql_utils.execute_scalar(
				f"SELECT COUNT(*) FROM {sql_utils.config['db']['prefix']}_user WHERE gid = %s;", 
				[self.id]
			)
			return data[0] if data else 0
		except Exception:
			return 0

