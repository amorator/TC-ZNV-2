from datetime import datetime as dt
from re import sub

class Request():
	def __init__(self, id, date, creator, account, description, status1='', status2='', start_date='', end_date='', final_date='', files=''):
		self.default_status = 'Ожидает решения...'
		self.approve = 'Согласовано'
		self.disapprove = 'Отказано'
		self.allow = 'Разрешено'
		self.deny = 'Запрещено'
		self.id = id
		self.date = date
		self.creator = creator
		self.account = account
		self.description = description
		self.files = files.split('|')
		self.start_date = start_date
		self.end_date = end_date
		self.status1 = status1 if status1 else self.default_status
		self.status2 = status2 if status2 else self.default_status
		self.final_date = final_date

	def status_approve(self):
		if self.approve in self.status1:
			return 1
		if self.disapprove in self.status1:
			return -1
		return 0

	def status_allow(self):
		if self.allow in self.status2:
			return 1
		if self.deny in self.status2:
			return -1
		return 0

	def status_edit(self):
		if self.status_approve() != 1:
			return 1
		if self.status_allow() == 1 and not bool(self.final_date):
			return -1
		return 0

	def approve_now(self, user, group):
		if self.allow in self.status2 or self.deny in self.status2:
			raise Exception('Невозможно внести измененя после решения главного инженера!')
		elif bool(self.final_date):
			raise Exception('Невозможно изменить закрытую заявку!')
		self.status1 = f'{self.approve}\n{dt.now().strftime("%d.%m.%y %H:%M")}\n{user} ({group})'
		return True

	def disapprove_now(self, user, group, reason='Причина: не указана.'):
		if self.allow in self.status2 or self.deny in self.status2:
			raise Exception('Невозможно внести измененя после решения главного инженера!')
		elif bool(self.final_date):
			raise Exception('Невозможно изменить закрытую заявку!')
		if not reason:
			reason = 'Причина: не указана.'
		self.status1 = f'{self.disapprove}\n{dt.now().strftime("%d.%m.%y %H:%M")}\n{user} ({group})\n{reason}'
		return True

	def allow_now(self, user, group):
		if bool(self.final_date):
			raise Exception('Невозможно изменить закрытую заявку!')
		if bool(self.start_date):
			raise Exception('Невозможно изменить начатую заявку!')
		self.status2 = f'{self.allow}\n{dt.now().strftime("%d.%m.%y %H:%M")}\n{user} ({group})'
		return True

	def deny_now(self, user, group, reason='Причина: не указана.'):
		if bool(self.final_date):
			raise Exception('Невозможно изменить закрытую заявку!')
		if bool(self.start_date):
			raise Exception('Невозможно изменить начатую заявку!')
		if not reason:
			reason = 'Причина: не указана.'
		self.status2 = f'{self.deny}\n{dt.now().strftime("%d.%m.%y %H:%M")}\n{user} ({group})\n{reason}'
		return True
