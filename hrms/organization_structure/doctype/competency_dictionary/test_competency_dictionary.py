# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

import frappe
from frappe.tests.utils import FrappeTestCase


class TestCompetencyDictionary(FrappeTestCase):
	def _new_dictionary(self):
		# Build in-memory; Position is a heavy NestedSet doc, so we exercise the
		# controller logic without persisting a full org structure.
		return frappe.new_doc("Competency Dictionary")

	def test_core_summary_has_no_proficiency_level(self):
		doc = self._new_dictionary()
		doc.append("core_competencies", {"competency": "Integrity", "definition": "Acts ethically."})
		doc.build_summary()

		self.assertEqual(len(doc.competency_summary), 1)
		row = doc.competency_summary[0]
		self.assertEqual(row.competency_type, "Core")
		self.assertEqual(row.required_proficiency_level, 0)
		self.assertEqual(row.required_proficiency_label, "-")

	def test_functional_summary_carries_required_level_label(self):
		doc = self._new_dictionary()
		doc.append(
			"functional_competencies",
			{
				"competency_type": "Functional",
				"competency": "Credit Analysis",
				"definition": "Assesses credit risk.",
				"required_proficiency_level": 3,
			},
		)
		doc.build_summary()

		row = doc.competency_summary[0]
		self.assertEqual(row.competency_type, "Functional")
		self.assertEqual(row.required_proficiency_level, 3)
		self.assertEqual(row.required_proficiency_label, "Proficient")

	def test_leadership_required_when_category_requires_it(self):
		doc = self._new_dictionary()
		doc.requires_leadership_competency = 1
		# No leadership rows -> validation must complain.
		with self.assertRaises(frappe.ValidationError):
			doc.validate_leveled_competencies(doc.leadership_competencies, "Leadership")

	def test_core_requires_definition(self):
		doc = self._new_dictionary()
		doc.append("core_competencies", {"competency": "Integrity", "definition": ""})
		with self.assertRaises(frappe.ValidationError):
			doc.validate_core_competencies()
