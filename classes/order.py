from datetime import datetime as dt
from re import sub

class Order():
	def __init__(self, id, state, attachment, number, iss_date, start_date, end_date, comp_date, responsible, jobs, approved, department, viewed, creator, note):
		self.id = id
		self.state = state
		self.attachments = attachment.split('|') if attachment else []
		self.number = note.count("\n") if note else number
		self.iss_date = iss_date
		self.start_date = start_date
		self.end_date = end_date
		self.comp_date = comp_date
		self.responsible = responsible
		self.jobs = jobs
		self.approved = approved 
		self.department = department
		self.viewed = viewed
		self.creator = creator
		self.note = note
		if state == 0:
			self.state_name = "Работы ведутся"
		elif state == -1:
			self.state_name = "Работы не ведутся"
		else:
			self.state_name = "Работы завершены"
		
