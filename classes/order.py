class Order:
	def __init__(self, id, service, status, number, issued, start, end, responsible, work_name, approved, created_at=None, updated_at=None):
		self.id = int(id)
		self.service = service or ""
		self.status = status or ""
		self.number = number or ""
		self.issued = issued
		self.start = start
		self.end = end
		self.responsible = responsible or ""
		self.work_name = work_name or ""
		self.approved = bool(approved)
		self.created_at = created_at
		self.updated_at = updated_at
		# Derived human-readable status
		st = (self.status or "").strip().lower()
		if st in ("in_progress", "process", "0"):
			self.status_name = "Работы ведутся"
		elif st in ("stopped", "-1"):
			self.status_name = "Работы не ведутся"
		elif st in ("done", "1", "completed"):
			self.status_name = "Работы завершены"
		else:
			self.status_name = self.status or ""