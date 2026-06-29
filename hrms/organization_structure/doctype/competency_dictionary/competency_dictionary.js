// Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
// For license information, please see license.txt

frappe.ui.form.on("Competency Dictionary", {
	onload(frm) {
		// Only real (non-group) positions can hold a competency dictionary.
		frm.set_query("job_position", () => ({ filters: { is_group: 0 } }));
	},

	refresh(frm) {
		frm.get_field("core_competencies").grid.set_multiple_add?.("competency");

		if (frm.doc.job_position && !frm.doc.job_category) {
			frm.dashboard.set_headline(
				__("This position has no Job Category. Set one on the Position before saving."),
			);
		}
	},

	job_position(frm) {
		if (!frm.doc.job_position) {
			frm.set_value("job_category", null);
			frm.set_value("requires_leadership_competency", 0);
			return;
		}

		frappe.call({
			method: "hrms.organization_structure.doctype.competency_dictionary.competency_dictionary.get_position_job_category",
			args: { position: frm.doc.job_position },
			callback: (r) => {
				if (!r.message) return;
				frm.set_value("job_category", r.message.job_category || null);
				frm.set_value(
					"requires_leadership_competency",
					r.message.requires_leadership_competency || 0,
				);

				if (!r.message.job_category) {
					frappe.msgprint({
						title: __("No Job Category"),
						message: __(
							"Position {0} has no Job Category. Set a Job Category on the Position first.",
							[frm.doc.job_position.bold()],
						),
						indicator: "orange",
					});
				}
			},
		});
	},
});
