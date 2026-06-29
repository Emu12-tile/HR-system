# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import cint

# Proficiency level descriptions on Competency Dictionary Item, in order 1..5.
LEVEL_FIELDS = (
	"level_1_novice",
	"level_2_intermediate",
	"level_3_proficient",
	"level_4_advanced",
	"level_5_expert",
)

LEVEL_LABELS = {
	1: "Novice",
	2: "Intermediate",
	3: "Proficient",
	4: "Advanced",
	5: "Expert",
}


class CompetencyDictionary(Document):
	def validate(self):
		self.sync_job_category()
		self.validate_core_competencies()
		self.validate_leveled_competencies(self.functional_competencies, "Functional")
		if self.requires_leadership_competency:
			self.validate_leveled_competencies(self.leadership_competencies, "Leadership")
		else:
			# Category does not require leadership competencies: drop any stray rows.
			self.leadership_competencies = []
		self.build_summary()

	def sync_job_category(self):
		"""Pull job category + leadership flag from the linked Position (server-side source of truth)."""
		info = get_position_job_category(self.job_position)
		self.job_category = info.get("job_category")
		self.requires_leadership_competency = info.get("requires_leadership_competency")

		if not self.job_category:
			frappe.throw(
				_("Position {0} has no Job Category. Set a Job Category on the Position first.").format(
					frappe.bold(self.job_position)
				)
			)

	def validate_core_competencies(self):
		if not self.core_competencies:
			frappe.throw(_("At least one Core competency is required."))

		for row in self.core_competencies:
			if not (row.competency and row.competency.strip()):
				frappe.throw(_("Row #{0}: Core competency name is required.").format(row.idx))
			if not (row.definition and row.definition.strip()):
				frappe.throw(
					_("Row #{0}: Definition is required for core competency {1}.").format(
						row.idx, frappe.bold(row.competency)
					)
				)

	def validate_leveled_competencies(self, rows, competency_type: str):
		if not rows:
			frappe.throw(_("At least one {0} competency is required.").format(competency_type))

		for row in rows:
			row.competency_type = competency_type
			missing = []
			if not (row.competency and row.competency.strip()):
				missing.append(_("Competency"))
			if not (row.definition and row.definition.strip()):
				missing.append(_("Definition"))
			for index, field in enumerate(LEVEL_FIELDS, start=1):
				if not (row.get(field) and str(row.get(field)).strip()):
					missing.append(_("Level {0}").format(index))

			level = cint(row.required_proficiency_level)
			if level < 1 or level > 5:
				missing.append(_("Required Proficiency Level (1-5)"))

			if missing:
				frappe.throw(
					_("{0} competency (Row #{1}) is incomplete. Missing: {2}").format(
						competency_type, row.idx, ", ".join(missing)
					)
				)

	def build_summary(self):
		self.competency_summary = []

		for row in self.core_competencies:
			self.append(
				"competency_summary",
				{
					"competency_type": "Core",
					"competency": row.competency,
					"definition": row.definition,
					"required_proficiency_level": 0,
					"required_proficiency_label": "-",
				},
			)

		leveled = list(self.functional_competencies)
		if self.requires_leadership_competency:
			leveled += list(self.leadership_competencies)

		for row in leveled:
			level = cint(row.required_proficiency_level)
			self.append(
				"competency_summary",
				{
					"competency_type": row.competency_type,
					"competency": row.competency,
					"definition": row.definition,
					"required_proficiency_level": level,
					"required_proficiency_label": LEVEL_LABELS.get(level, ""),
				},
			)


@frappe.whitelist()
def get_position_job_category(position: str | None) -> dict:
	"""Return the Job Category and leadership requirement for a Position.

	Used by the Competency Dictionary form and the Position form's "Add Competency" button.
	"""
	if not position:
		return {}

	job_category = frappe.db.get_value("Position", position, "job_category")
	requires_leadership = 0
	if job_category:
		requires_leadership = (
			frappe.db.get_value("Job Category", job_category, "requires_leadership_competency") or 0
		)

	return {
		"job_category": job_category,
		"requires_leadership_competency": cint(requires_leadership),
	}
