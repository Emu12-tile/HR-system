import frappe

from hrms.organization_structure.doctype.job_grade.job_grade import grade_level_to_int


def execute():
	"""Backfill the numeric sort key for existing Job Grade records."""
	for name, grade_level in frappe.get_all("Job Grade", fields=["name", "grade_level"], as_list=True):
		frappe.db.set_value(
			"Job Grade", name, "grade_value", grade_level_to_int(grade_level), update_modified=False
		)
