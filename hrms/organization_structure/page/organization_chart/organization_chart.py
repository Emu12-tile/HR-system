# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

import frappe

from hrms.organization_structure.doctype.position.position import resolve_position_chart_unit

POSITION_ORG_UNIT_FIELDS = (
	"org_function",
	"org_process",
	"org_sub_process",
	"org_department",
	"org_district",
	"org_team",
	"org_branch",
	"org_sub_team",
	"organization_unit",
	"site_organization_unit",
)

POSITION_CHART_FIELDS = (
	"name",
	"position_name",
	"parent_position",
	"current_employee",
	"is_occupied",
	"is_head_position",
	"lft",
	*POSITION_ORG_UNIT_FIELDS,
)


@frappe.whitelist()
def get_chart_data():
	"""Return the Organization Unit hierarchy with positions nested under each unit.

	Each org unit box shows its head position (if any). All other active positions
	linked to the unit appear below it in a reporting sub-tree.
	"""
	units = frappe.get_all(
		"Organization Unit",
		fields=[
			"name",
			"unit_name",
			"unit_type",
			"parent_organization_unit",
			"status",
			"lft",
		],
		order_by="lft asc",
	)

	unit_map = {unit.name: unit for unit in units}
	visible_units = _get_visible_unit_names(units, unit_map)

	head_positions = _get_head_positions(visible_units)
	positions_by_unit = _get_positions_by_unit(head_positions, visible_units)
	employee_names = _get_employee_names(_collect_employee_ids(head_positions, positions_by_unit))

	for unit_positions in positions_by_unit.values():
		_attach_employee_names(unit_positions, employee_names)

	nodes = {}
	for unit in units:
		if unit.name not in visible_units:
			continue

		head = head_positions.get(unit.name)
		# Only a position flagged is_head_position fills the unit box. Every other
		# position renders as its own box linked beneath the unit (no promotion).
		unit_positions = positions_by_unit.get(unit.name, [])

		nodes[unit.name] = {
			"id": unit.name,
			"unit": unit.unit_name,
			"unit_type": unit.unit_type or "",
			"has_head": 1 if head else 0,
			"title": head.position_name if head else "",
			"employee": (employee_names.get(head.current_employee) if head else "") or "",
			"occupied": 1 if (head and head.is_occupied) else 0,
			"positions": unit_positions,
			"children": [],
		}

	roots = []
	for unit in units:
		if unit.name not in visible_units:
			continue

		node = nodes[unit.name]
		parent_name = _nearest_visible_parent(unit.name, visible_units, unit_map)
		parent = nodes.get(parent_name) if parent_name else None
		if parent:
			parent["children"].append(node)
		else:
			roots.append(node)

	return roots


def _get_visible_unit_names(units: list, unit_map: dict) -> set[str]:
	"""Active units with no inactive ancestor (inactive subtrees are excluded)."""
	visible = set()

	for unit in units:
		if not _is_unit_active(unit):
			continue

		parent = unit.parent_organization_unit
		has_inactive_ancestor = False
		while parent:
			parent_unit = unit_map.get(parent)
			if not parent_unit:
				break
			if not _is_unit_active(parent_unit):
				has_inactive_ancestor = True
				break
			parent = parent_unit.parent_organization_unit

		if not has_inactive_ancestor:
			visible.add(unit.name)

	return visible


def _is_unit_active(unit) -> bool:
	return (unit.status or "Active").strip() == "Active"


def _position_has_hidden_org_link(row, visible_units: set[str]) -> bool:
	for field in POSITION_ORG_UNIT_FIELDS:
		value = row.get(field)
		if value and value not in visible_units:
			return True
	return False


def _position_is_chart_visible(row, visible_units: set[str]) -> bool:
	if _position_has_hidden_org_link(row, visible_units):
		return False

	target_unit = resolve_position_chart_unit(row)
	return bool(target_unit and target_unit in visible_units)


def _nearest_visible_parent(unit_name: str, visible_units: set[str], unit_map: dict) -> str | None:
	parent = unit_map[unit_name].parent_organization_unit
	while parent:
		if parent in visible_units:
			return parent
		parent_unit = unit_map.get(parent)
		parent = parent_unit.parent_organization_unit if parent_unit else None
	return None


def _get_head_positions(visible_units: set[str]):
	"""Map each organization unit to its head position (first one wins)."""
	rows = frappe.get_all(
		"Position",
		filters={"is_head_position": 1, "position_status": "Active"},
		fields=list(POSITION_CHART_FIELDS),
		order_by="lft asc",
	)

	heads = {}
	for row in rows:
		if not _position_is_chart_visible(row, visible_units):
			continue

		unit = resolve_position_chart_unit(row)
		if unit and unit not in heads:
			heads[unit] = row
	return heads


def _get_positions_by_unit(head_positions: dict, visible_units: set[str]) -> dict:
	"""Group active positions by organization unit, excluding head positions shown in the unit box."""
	rows = frappe.get_all(
		"Position",
		filters={"position_status": "Active"},
		fields=list(POSITION_CHART_FIELDS),
		order_by="lft asc",
	)

	head_ids = {head.name for head in head_positions.values()}
	by_unit: dict[str, list] = {}

	for row in rows:
		if row.name in head_ids:
			continue

		if not _position_is_chart_visible(row, visible_units):
			continue

		target_unit = resolve_position_chart_unit(row)
		if not target_unit:
			continue

		by_unit.setdefault(target_unit, []).append(
			{
				"id": row.name,
				"title": row.position_name,
				"current_employee": row.current_employee,
				"employee": "",
				"occupied": 1 if row.is_occupied else 0,
				"parent_position": row.parent_position,
			}
		)

	return {unit: _build_position_tree(positions) for unit, positions in by_unit.items()}


def _build_position_tree(positions: list) -> list:
	"""Build a nested reporting tree for positions within one organization unit."""
	index = {row["id"]: {**row, "children": []} for row in positions}
	roots = []

	for row in positions:
		node = index[row["id"]]
		parent = row.get("parent_position")
		if parent and parent in index:
			index[parent]["children"].append(node)
		else:
			roots.append(node)

	return roots


def _collect_employee_ids(head_positions: dict, positions_by_unit: dict) -> list[str]:
	employee_ids = [head.current_employee for head in head_positions.values() if head.current_employee]

	def walk(nodes):
		for node in nodes:
			if node.get("current_employee"):
				employee_ids.append(node["current_employee"])
			walk(node.get("children") or [])

	for roots in positions_by_unit.values():
		walk(roots)

	return employee_ids


def _attach_employee_names(nodes: list, employee_names: dict) -> None:
	for node in nodes:
		node["employee"] = employee_names.get(node.get("current_employee")) or ""
		_attach_employee_names(node.get("children") or [], employee_names)


def _get_employee_names(employee_ids: list) -> dict:
	if not employee_ids:
		return {}

	rows = frappe.get_all(
		"Employee",
		filters={"name": ["in", list(set(employee_ids))]},
		fields=["name", "employee_name"],
	)
	return {row.name: row.employee_name for row in rows}
