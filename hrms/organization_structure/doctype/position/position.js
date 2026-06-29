// Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
// For license information, please see license.txt

// Organization Unit cascade: each level is filtered to children of the nearest parent above.
// Department/District share the same level; Team/Branch share the next level.
const ORG_CASCADE = [
	{
		field: "org_function",
		type: "Function",
		parentFields: [],
		clearDownstream: [
			"org_process",
			"org_sub_process",
			"org_department",
			"org_district",
			"org_team",
			"org_branch",
			"org_sub_team",
		],
	},
	{
		field: "org_process",
		type: "Process",
		parentFields: ["org_function"],
		clearDownstream: [
			"org_sub_process",
			"org_department",
			"org_district",
			"org_team",
			"org_branch",
			"org_sub_team",
		],
	},
	{
		field: "org_sub_process",
		type: "Sub-Process",
		parentFields: ["org_process", "org_function"],
		clearDownstream: [
			"org_department",
			"org_district",
			"org_team",
			"org_branch",
			"org_sub_team",
		],
	},
	{
		field: "org_department",
		type: "Department",
		parentFields: ["org_sub_process", "org_process", "org_function"],
		clearDownstream: ["org_team", "org_sub_team"],
	},
	{
		field: "org_district",
		type: "District",
		parentFields: ["org_sub_process", "org_process", "org_function"],
		clearDownstream: ["org_branch", "org_sub_team"],
	},
	{
		field: "org_team",
		type: "Team",
		parentFields: ["org_department", "org_sub_process", "org_process", "org_function"],
		clearDownstream: ["org_sub_team"],
	},
	{
		field: "org_branch",
		type: "Branch",
		parentFields: ["org_district", "org_sub_process", "org_process", "org_function"],
		clearDownstream: ["org_sub_team"],
	},
	{
		field: "org_sub_team",
		type: "Sub-Team",
		parentFields: [
			"org_team",
			"org_branch",
			"org_department",
			"org_district",
			"org_sub_process",
			"org_process",
			"org_function",
		],
		clearDownstream: [],
	},
];

// Org cascade fields to hide for each Location 1 (physical site type).
const ORG_FIELDS_HIDDEN_BY_LOCATION_1 = {
	"Head Office": ["org_district", "org_branch"],
	"District Office": ["org_department", "org_sub_team"],
	Branch: ["org_department", "org_team"],
};

function hidden_org_fields_for_location(location_1) {
	return ORG_FIELDS_HIDDEN_BY_LOCATION_1[location_1] || [];
}

function apply_org_cascade_visibility(frm) {
	const hidden = new Set(hidden_org_fields_for_location(frm.doc.location_1));

	ORG_CASCADE.forEach((level) => {
		const should_hide = hidden.has(level.field);
		frm.set_df_property(level.field, "hidden", should_hide ? 1 : 0);
		if (should_hide && frm.doc[level.field]) {
			frm.set_value(level.field, null);
		}
	});

	if (hidden.size) {
		resolve_organization_unit(frm);
	}
}

function first_set_parent(frm, parentFields) {
	for (const field of parentFields) {
		if (frm.doc[field]) return frm.doc[field];
	}
	return null;
}

function set_org_cascade_queries(frm) {
	ORG_CASCADE.forEach((level) => {
		frm.set_query(level.field, () => {
			const filters = { unit_type: level.type };
			const parent = first_set_parent(frm, level.parentFields);
			if (parent) {
				filters.parent_organization_unit = parent;
			}
			return { filters };
		});
	});
}

function set_site_queries(frm) {
	frm.set_query("site_organization_unit", () => {
		const filters = { status: "Active", location_1: ["is", "set"] };
		if (frm.doc.location_1) {
			filters.location_1 = frm.doc.location_1;
		}
		return { filters };
	});
}

function sync_location_1_from_site(frm) {
	if (!frm.doc.site_organization_unit || frm.doc.location_1) return;

	frappe.db.get_value(
		"Organization Unit",
		frm.doc.site_organization_unit,
		"location_1",
		(r) => {
			if (r?.location_1) {
				frm.set_value("location_1", r.location_1);
				apply_org_cascade_visibility(frm);
			}
		},
	);
}

function clear_site_if_type_mismatch(frm) {
	if (!frm.doc.site_organization_unit || !frm.doc.location_1) return;

	frappe.db.get_value(
		"Organization Unit",
		frm.doc.site_organization_unit,
		"location_1",
		(r) => {
			if (r?.location_1 && r.location_1 !== frm.doc.location_1) {
				frm.set_value("site_organization_unit", null);
			}
		},
	);
}

function clear_downstream_org_levels(frm, changed_field) {
	const level = ORG_CASCADE.find((l) => l.field === changed_field);
	if (!level) return;

	level.clearDownstream.forEach((field) => {
		if (frm.doc[field]) {
			frm.set_value(field, null);
		}
	});
}

function resolve_organization_unit(frm) {
	sync_org_cascade_from_cost_center(frm);

	const hidden = new Set(hidden_org_fields_for_location(frm.doc.location_1));
	for (let i = ORG_CASCADE.length - 1; i >= 0; i--) {
		const field = ORG_CASCADE[i].field;
		if (hidden.has(field)) continue;

		const value = frm.doc[field];
		if (value) {
			frm.set_value("organization_unit", value);
			frm.set_value("cost_center", value);
			return;
		}
	}

	if (frm.doc.cost_center) {
		frm.set_value("organization_unit", frm.doc.cost_center);
	} else {
		frm.set_value("organization_unit", null);
	}
}

function sync_org_cascade_from_cost_center(frm, unit_name) {
	const target = unit_name || frm.doc.cost_center;
	if (!target) return;

	frappe.db.get_value("Organization Unit", target, "unit_type", (r) => {
		if (!r?.unit_type) return;
		const field = {
			Function: "org_function",
			Process: "org_process",
			"Sub-Process": "org_sub_process",
			Department: "org_department",
			District: "org_district",
			Team: "org_team",
			Branch: "org_branch",
			"Sub-Team": "org_sub_team",
		}[r.unit_type];
		if (field && !frm.doc[field]) {
			frm.set_value(field, target);
		}
	});
}

function populate_org_cascade(frm) {
	if (!frm.doc.organization_unit) return;
	if (ORG_CASCADE.some((l) => frm.doc[l.field])) return;

	frappe.call({
		method: "hrms.organization_structure.doctype.position.position.get_organization_hierarchy",
		args: { organization_unit: frm.doc.organization_unit },
		callback: (r) => {
			if (!r.message) return;
			Object.entries(r.message).forEach(([field, value]) => {
				frm.doc[field] = value;
			});
			frm.refresh_fields(ORG_CASCADE.map((l) => l.field));
		},
	});
}

// Open the Competency Dictionary for this position, creating it if none exists.
// Competency Dictionary is auto-named after the position, so its name == frm.doc.name.
function open_competency_dictionary(frm) {
	if (!frm.doc.job_category) {
		frappe.msgprint({
			title: __("Job Category required"),
			message: __(
				"Set a Job Category on this position before defining competencies. " +
					"The competency dictionary derives core/functional/leadership requirements from it.",
			),
			indicator: "orange",
		});
		return;
	}

	frappe.db.exists("Competency Dictionary", frm.doc.name).then((exists) => {
		if (exists) {
			frappe.set_route("Form", "Competency Dictionary", frm.doc.name);
		} else {
			frappe.new_doc("Competency Dictionary", { job_position: frm.doc.name });
		}
	});
}

frappe.ui.form.on("Position", {
	onload(frm) {
		set_org_cascade_queries(frm);
		set_site_queries(frm);

		if (frm.is_new() && !frm.doc.company) {
			const company = frappe.defaults.get_user_default("Company");
			if (company) frm.set_value("company", company);
		}
	},

	refresh(frm) {
		frm.add_custom_button(__("Position Tree"), () => {
			frappe.set_route("Tree", "Position");
		});

		if (!frm.is_new()) {
			frm.add_custom_button(__("Add Competency"), () => {
				open_competency_dictionary(frm);
			});
		}

		populate_org_cascade(frm);
		sync_location_1_from_site(frm);
		apply_org_cascade_visibility(frm);
		sync_position_end_date(frm);

		if (frm.doc.occupancy_status === "Occupied" && frm.doc.current_employee) {
			frm.dashboard.set_headline(
				__("Occupied by {0}", [frm.doc.current_employee.bold()]),
			);
		} else if (!frm.is_new()) {
			frm.dashboard.set_headline(__("This position is currently vacant."));
		}
	},

	position_template(frm) {
		if (!frm.doc.position_template) return;

		frappe.db.get_value(
			"Position Template",
			frm.doc.position_template,
			["job_grade", "job_category"],
			(r) => {
				if (!r) return;
				if (r.job_grade && !frm.doc.job_grade) {
					frm.set_value("job_grade", r.job_grade);
				}
				if (r.job_category && !frm.doc.job_category) {
					frm.set_value("job_category", r.job_category);
				}
			},
		);
	},

	position_status(frm) {
		sync_position_end_date(frm);
	},

	location_1(frm) {
		clear_site_if_type_mismatch(frm);
		apply_org_cascade_visibility(frm);
	},

	site_organization_unit(frm) {
		if (frm.doc.site_organization_unit && !frm.doc.location_1) {
			frappe.db.get_value(
				"Organization Unit",
				frm.doc.site_organization_unit,
				"location_1",
				(r) => {
					if (r?.location_1) {
						frm.set_value("location_1", r.location_1);
						apply_org_cascade_visibility(frm);
					}
				},
			);
		} else {
			apply_org_cascade_visibility(frm);
		}
	},

	org_function(frm) {
		clear_downstream_org_levels(frm, "org_function");
		resolve_organization_unit(frm);
	},

	org_process(frm) {
		clear_downstream_org_levels(frm, "org_process");
		resolve_organization_unit(frm);
	},

	org_sub_process(frm) {
		clear_downstream_org_levels(frm, "org_sub_process");
		resolve_organization_unit(frm);
	},

	org_department(frm) {
		clear_downstream_org_levels(frm, "org_department");
		resolve_organization_unit(frm);
	},

	org_district(frm) {
		clear_downstream_org_levels(frm, "org_district");
		resolve_organization_unit(frm);
	},

	org_team(frm) {
		clear_downstream_org_levels(frm, "org_team");
		resolve_organization_unit(frm);
	},

	org_branch(frm) {
		clear_downstream_org_levels(frm, "org_branch");
		resolve_organization_unit(frm);
	},

	org_sub_team(frm) {
		resolve_organization_unit(frm);
	},

	cost_center(frm) {
		sync_org_cascade_from_cost_center(frm);
		resolve_organization_unit(frm);
	},

	parent_position(frm) {
		if (frm.doc.parent_position === frm.doc.name) {
			frappe.msgprint(__("A Position cannot report to itself."));
			frm.set_value("parent_position", null);
		}
	},
});

function sync_position_end_date(frm) {
	if (frm.doc.position_status === "Inactive") {
		if (!frm.doc.position_end_date) {
			frm.set_value("position_end_date", frappe.datetime.get_today());
		}
	} else if (frm.doc.position_end_date) {
		frm.set_value("position_end_date", null);
	}
}
