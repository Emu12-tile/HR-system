// Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
// For license information, please see license.txt

const PARENT_LOCATION_1 = {
	"District Office": "Head Office",
	Branch: "District Office",
};

frappe.ui.form.on("Organization Unit", {
	setup(frm) {
		frm.set_query("region", () => ({
			filters: { status: "Active" },
		}));

		frm.set_query("zone", () => {
			const filters = { status: "Active" };
			if (frm.doc.region) filters.region = frm.doc.region;
			return { filters };
		});

		frm.set_query("city", () => {
			const filters = { status: "Active" };
			if (frm.doc.region) filters.region = frm.doc.region;
			if (frm.doc.zone) filters.zone = frm.doc.zone;
			return { filters };
		});

		frm.set_query("woreda", () => {
			const filters = { status: "Active" };
			if (frm.doc.city) filters.city = frm.doc.city;
			return { filters };
		});

		frm.set_query("parent_organization_unit", () => {
			if (!frm.doc.location_1 || frm.doc.location_1 === "Head Office") {
				return {};
			}
			const expected = PARENT_LOCATION_1[frm.doc.location_1];
			if (!expected) return {};
			return {
				filters: {
					location_1: expected,
					status: "Active",
				},
			};
		});
	},

	refresh(frm) {
		sync_unit_start_date(frm);
		sync_unit_end_date(frm);

		frm.add_custom_button(__("Organization Tree"), () => {
			frappe.set_route("Tree", "Organization Unit");
		});

		if (!frm.is_new()) {
			frm.add_custom_button(__("Location Chart"), () => {
				frappe.set_route("location-chart");
			});

			frm.add_custom_button(
				__("Positions"),
				() => {
					frappe.set_route("List", "Position", {
						site_organization_unit: frm.doc.name,
					});
				},
				__("View"),
			);
		}

		if (frm.doc.location_1 === "Branch" && !frm.is_new()) {
			frm.add_custom_button(
				__("Generate Positions"),
				() => generate_branch_positions(frm),
				__("Actions"),
			);
		}

		if (frm.doc.is_primary_head_office && !frm.is_new()) {
			frm.add_custom_button(
				__("Apply Geography to Head Offices"),
				() => propagate_ho_geography(frm),
				__("Actions"),
			);
		}
	},

	location_1(frm) {
		if (frm.doc.location_1 === "Head Office") {
			if (!frm.doc.is_primary_head_office) {
				frm.set_value("inherit_ho_geography", 1);
			}
		} else {
			frm.set_value("is_primary_head_office", 0);
			frm.set_value("inherit_ho_geography", 0);
		}

		if (frm.doc.parent_organization_unit) {
			const expected = PARENT_LOCATION_1[frm.doc.location_1];
			if (expected) {
				frappe.db.get_value(
					"Organization Unit",
					frm.doc.parent_organization_unit,
					"location_1",
					(r) => {
						if (r && r.location_1 !== expected) {
							frm.set_value("parent_organization_unit", null);
						}
					},
				);
			}
		}
	},

	is_primary_head_office(frm) {
		if (frm.doc.is_primary_head_office) {
			frm.set_value("inherit_ho_geography", 0);
		} else if (frm.doc.location_1 === "Head Office") {
			frm.set_value("inherit_ho_geography", 1);
		}
	},

	region(frm) {
		clear_dependent_geo(frm, "region");
	},

	zone(frm) {
		clear_dependent_geo(frm, "zone");
	},

	city(frm) {
		if (frm.doc.woreda) {
			frappe.db.get_value("Woreda", frm.doc.woreda, "city", (r) => {
				if (r && r.city !== frm.doc.city) frm.set_value("woreda", null);
			});
		}
	},

	parent_organization_unit(frm) {
		if (frm.doc.parent_organization_unit === frm.doc.name) {
			frappe.msgprint(__("An Organization Unit cannot be its own parent."));
			frm.set_value("parent_organization_unit", null);
		}
		update_unit_code_preview(frm);
	},

	unit_name(frm) {
		update_unit_code_preview(frm);
	},

	unit_type(frm) {
		update_unit_code_preview(frm);
	},

	short_code(frm) {
		update_unit_code_preview(frm);
	},

	status(frm) {
		sync_unit_end_date(frm);
	},

	before_save(frm) {
		confirm_inactive_status(frm);
	},

	after_save(frm) {
		frm._inactive_status_confirmed = false;
		frappe.realtime.publish("organization_chart_refresh");
	},
});

function confirm_inactive_status(frm) {
	const becoming_inactive = frm.doc.status === "Inactive";
	const needs_confirm =
		becoming_inactive && (frm.is_new() || frm.is_dirty("status")) && !frm._inactive_status_confirmed;

	if (!needs_confirm) {
		return;
	}

	frappe.validated = false;

	const unit_label = frappe.utils.escape_html(
		frm.doc.unit_name || frm.doc.name || __("this organization unit"),
	);
	const end_date = frappe.datetime.str_to_user(
		frm.doc.unit_end_date || frappe.datetime.get_today(),
	);

	const dialog = new frappe.ui.Dialog({
		title: __("Mark Organization Unit Inactive?"),
		size: "large",
		fields: [
			{
				fieldname: "inactive_confirm_html",
				fieldtype: "HTML",
				options: get_inactive_confirm_html(unit_label, end_date),
			},
			{
				fieldname: "acknowledge",
				fieldtype: "Check",
				label: __("I understand this unit will be hidden from the Organization Chart"),
			},
		],
		primary_action_label: __("Yes, Mark Inactive"),
		primary_action() {
			if (!dialog.get_value("acknowledge")) {
				frappe.show_alert({
					message: __("Please confirm that you understand the effects."),
					indicator: "orange",
				});
				return;
			}

			dialog.hide();
			frm._inactive_status_confirmed = true;
			frm.save();
		},
	});

	dialog.set_secondary_action_label(__("Cancel"));
	dialog.set_secondary_action(() => dialog.hide());
	dialog.get_primary_btn().addClass("btn-danger").prop("disabled", true);
	dialog
		.get_primary_btn()
		.prepend(`${inactive_dialog_icon("close-circle", "xs")} `);
	const $secondary_btn = dialog.$wrapper.find(".btn-modal-secondary");
	if ($secondary_btn.length) {
		$secondary_btn.prepend(`${inactive_dialog_icon("arrow-left", "xs")} `);
	}

	dialog.fields_dict.acknowledge.$input.on("change", () => {
		dialog.get_primary_btn().prop("disabled", !dialog.get_value("acknowledge"));
	});

	dialog.show();
}

function inactive_dialog_icon(name, size = "sm") {
	if (typeof frappe.utils.icon === "function") {
		return frappe.utils.icon(name, size);
	}
	return `<svg class="icon icon-${size}" aria-hidden="true"><use href="#icon-${name}"></use></svg>`;
}

function get_inactive_confirm_html(unit_label, end_date) {
	const effects = [
		{
			icon: "organization",
			text: __("Removed from the Organization Chart"),
		},
		{
			icon: "hierarchy",
			text: __("All units beneath it will also be hidden from the chart"),
		},
		{
			icon: "calendar",
			text: __("End Date will be set to {0}", [end_date]),
		},
		{
			icon: "restriction",
			text: __("No longer available when creating new positions or child units"),
		},
	];

	const effect_rows = effects
		.map(
			(effect) => `
			<li class="ou-inactive-effect">
				<span class="ou-inactive-effect__icon">${inactive_dialog_icon(effect.icon, "sm")}</span>
				<span class="ou-inactive-effect__text">${effect.text}</span>
			</li>`,
		)
		.join("");

	return `
		<style>
			.ou-inactive-confirm {
				margin-bottom: 0.5rem;
			}
			.ou-inactive-confirm__hero {
				display: flex;
				gap: 1rem;
				align-items: flex-start;
				padding: 1rem;
				border-radius: var(--border-radius-md);
				background: var(--alert-bg-warning);
				border: 1px solid var(--border-color);
				margin-bottom: 1rem;
			}
			.ou-inactive-confirm__icon {
				flex: 0 0 auto;
				color: var(--orange-500);
				line-height: 1;
			}
			.ou-inactive-confirm__icon .icon {
				width: 2rem;
				height: 2rem;
			}
			.ou-inactive-confirm__lead {
				margin: 0;
				line-height: 1.5;
			}
			.ou-inactive-confirm__subtitle {
				margin: 0.35rem 0 0;
				color: var(--text-muted);
				font-size: var(--text-sm);
			}
			.ou-inactive-confirm__effects {
				list-style: none;
				margin: 0;
				padding: 0;
			}
			.ou-inactive-effect {
				display: flex;
				align-items: flex-start;
				gap: 0.65rem;
				padding: 0.55rem 0.25rem;
				border-bottom: 1px solid var(--border-color);
			}
			.ou-inactive-effect:last-child {
				border-bottom: none;
			}
			.ou-inactive-effect__icon {
				flex: 0 0 auto;
				color: var(--text-muted);
				margin-top: 0.1rem;
			}
			.ou-inactive-effect__text {
				line-height: 1.45;
			}
		</style>
		<div class="ou-inactive-confirm">
			<div class="ou-inactive-confirm__hero">
				<div class="ou-inactive-confirm__icon">${inactive_dialog_icon("alert-triangle", "lg")}</div>
				<div>
					<p class="ou-inactive-confirm__lead">
						${__("You are about to inactivate")} <strong>${unit_label}</strong>.
					</p>
					<p class="ou-inactive-confirm__subtitle">
						${__("Review the effects below, then confirm to continue.")}
					</p>
				</div>
			</div>
			<ul class="ou-inactive-confirm__effects">${effect_rows}</ul>
		</div>
	`;
}

function sync_unit_start_date(frm) {
	if (!frm.doc.unit_start_date) {
		frm.set_value("unit_start_date", frappe.datetime.get_today());
	}
}

function sync_unit_end_date(frm) {
	if (frm.doc.status === "Inactive") {
		if (!frm.doc.unit_end_date) {
			frm.set_value("unit_end_date", frappe.datetime.get_today());
		}
	} else if (frm.doc.unit_end_date) {
		frm.set_value("unit_end_date", null);
	}
}

function update_unit_code_preview(frm) {
	// Fill the read-only Unit Code field live as the user builds a new unit, so
	// the generated code is visible before saving. Existing units keep their code,
	// so no preview runs on edit.
	if (!frm.is_new()) return;
	if (!frm.doc.unit_name && !frm.doc.short_code) {
		frm.set_value("unit_code", "");
		return;
	}

	frappe.call({
		method: "hrms.organization_structure.doctype.organization_unit.organization_unit.preview_unit_code",
		args: {
			unit_type: frm.doc.unit_type,
			parent_organization_unit: frm.doc.parent_organization_unit,
			unit_name: frm.doc.unit_name,
			short_code: frm.doc.short_code,
		},
		callback(r) {
			if (!r.message) return;
			frm.set_value("unit_code", r.message.unit_code || r.message.short_code || "");
		},
	});
}

function clear_dependent_geo(frm, changed) {
	if (changed === "region" && frm.doc.zone) {
		frappe.db.get_value("Zone", frm.doc.zone, "region", (r) => {
			if (r && r.region !== frm.doc.region) {
				frm.set_value("zone", null);
				frm.set_value("city", null);
				frm.set_value("woreda", null);
			}
		});
	}
	if (changed === "zone" && frm.doc.city) {
		frappe.db.get_value("City", frm.doc.city, "zone", (r) => {
			if (r && r.zone !== frm.doc.zone) {
				frm.set_value("city", null);
				frm.set_value("woreda", null);
			}
		});
	}
}

function generate_branch_positions(frm) {
	if (!frm.doc.branch_staffing_template) {
		frappe.msgprint(__("Set a Branch Staffing Template first."));
		return;
	}

	frappe.call({
		method: "hrms.organization_structure.doctype.organization_unit.organization_unit.create_branch_positions",
		args: { organization_unit: frm.doc.name },
		freeze: true,
		freeze_message: __("Generating positions..."),
		callback(r) {
			if (!r.message) return;
			const count = r.message.count || 0;
			frappe.show_alert({
				message:
					count > 0
						? __("Created {0} vacant position(s).", [count])
						: __("All positions for this branch already exist."),
				indicator: count > 0 ? "green" : "blue",
			});
		},
	});
}

function propagate_ho_geography(frm) {
	frappe.confirm(
		__(
			"Apply this Head Office geography to all other Head Office units that inherit geography?",
		),
		() => {
			frappe.call({
				method: "hrms.organization_structure.doctype.organization_unit.organization_unit.propagate_ho_geography",
				args: { organization_unit: frm.doc.name },
				freeze: true,
				callback(r) {
					const count = r.message?.updated || 0;
					frappe.show_alert({
						message: __("Updated geography on {0} Head Office unit(s).", [count]),
						indicator: "green",
					});
				},
			});
		},
	);
}
