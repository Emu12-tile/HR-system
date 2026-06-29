# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt


from frappe.model.document import Document

ROMAN_VALUES = {"I": 1, "V": 5, "X": 10, "L": 50, "C": 100, "D": 500, "M": 1000}


class JobGrade(Document):
	# begin: auto-generated types
	# This code is auto-generated. Do not modify anything in this block.

	from typing import TYPE_CHECKING

	if TYPE_CHECKING:
		from frappe.types import DF

		grade_level: DF.Data
		grade_value: DF.Int
	# end: auto-generated types

	def validate(self):
		# Numeric sort key so grades order naturally (I, II, X / 1, 2, 10)
		# instead of lexicographically by the text level.
		self.grade_value = grade_level_to_int(self.grade_level)


def grade_level_to_int(value: str) -> int:
	"""Convert a grade level to an integer for sorting.

	Accepts a plain number (e.g. "1", "10") or a Roman numeral (e.g. "I", "IV", "X").
	Returns 0 when the value can't be interpreted, so unparseable grades sort first.
	"""
	text = (value or "").strip().upper()
	if not text:
		return 0

	if text.isdigit():
		return int(text)

	return roman_to_int(text) or 0


def roman_to_int(text: str) -> int | None:
	"""Return the integer value of a Roman numeral, or None if it isn't valid."""
	total = 0
	prev = 0
	for char in reversed(text):
		current = ROMAN_VALUES.get(char)
		if current is None:
			return None
		if current < prev:
			total -= current
		else:
			total += current
			prev = current
	return total
