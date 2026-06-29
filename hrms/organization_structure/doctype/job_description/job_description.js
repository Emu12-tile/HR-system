// Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
// For license information, please see license.txt

frappe.ui.form.on("Job Description", {
	onload(frm) {
		// Only real (non-group) positions can hold a Job Description.
		frm.set_query("position_title", () => ({ filters: { is_group: 0 } }));
	},

	refresh(frm) {
		// Position cannot change once the JD exists (one JD per position).
		frm.set_df_property("position_title", "read_only", frm.is_new() ? 0 : 1);
		inject_styles();
		frm.layout.wrapper.addClass("jd-styled-form");
		number_sections(frm);
		render_previews(frm);
	},

	position_title(frm) {
		render_previews(frm);
	},
});

function inject_styles() {
	if (document.getElementById("jd-form-style")) return;
	const css = `
		.jd-styled-form .form-section{
			border:1px solid #d8e3ec;border-radius:8px;background:#fff;
			box-shadow:0 1px 3px rgba(15,23,42,.05);
			padding:0 18px 14px;margin-bottom:16px;overflow:hidden;}
		/* Numbered section bar (only on heads tagged by number_sections) */
		.jd-styled-form .form-section .section-head[data-jd-num]{
			display:flex;align-items:center;
			background:#d9edf7;color:#004b87;font-weight:700;font-size:14px;
			margin:0 -18px 14px;padding:11px 16px 11px 0;border:0;}
		.jd-styled-form .form-section .section-head[data-jd-num]::before{
			content:attr(data-jd-num);background:#0099cc;color:#fff;
			width:46px;align-self:stretch;margin:-11px 16px -11px 0;
			display:flex;align-items:center;justify-content:center;
			font-weight:700;font-size:15px;}
		/* Job Information section: preview supplies its own header; full-bleed body */
		.jd-styled-form .form-section.jd-info-section{padding-top:0;padding-left:0;padding-right:0;}
		.jd-styled-form .form-section.jd-info-section > .section-head{display:none;}
		/* Zero the column padding so the Position bar fills to the same edge as the table */
		.jd-styled-form .form-section.jd-info-section .form-column{padding-left:0 !important;padding-right:0 !important;}
		/* Position rendered as the navy full-width title bar */
		/* The position_title .frappe-control itself has class .input-max-width, which
		   Frappe caps at 50% in single-column sections — override on the element itself */
		.jd-styled-form [data-fieldname="position_title"]{width:100% !important;max-width:100% !important;}
		.jd-styled-form [data-fieldname="position_title"] > .clearfix{display:none;}
		.jd-styled-form [data-fieldname="position_title"] .control-input-wrapper,
		.jd-styled-form [data-fieldname="position_title"] .control-value,
		.jd-styled-form [data-fieldname="position_title"] .like-disabled-input,
		.jd-styled-form [data-fieldname="position_title"] .control-input,
		.jd-styled-form [data-fieldname="position_title"] .control-input input{
			width:100% !important;max-width:100% !important;}
		.jd-styled-form [data-fieldname="position_title"] .control-value,
		.jd-styled-form [data-fieldname="position_title"] .like-disabled-input,
		.jd-styled-form [data-fieldname="position_title"] .control-input input{
			background:#00334e;font-weight:700;font-size:15px;
			padding:14px 20px;border:0;border-radius:4px;height:auto;line-height:1.3;
			caret-color:#fff;box-shadow:none;}
		.jd-styled-form [data-fieldname="position_title"] .control-value,
		.jd-styled-form [data-fieldname="position_title"] .control-value a,
		.jd-styled-form [data-fieldname="position_title"] .like-disabled-input,
		.jd-styled-form [data-fieldname="position_title"] .like-disabled-input a,
		.jd-styled-form [data-fieldname="position_title"] .control-input input{
			color:#fff !important;}
		.jd-styled-form [data-fieldname="position_title"] .control-input input::placeholder{
			color:rgba(255,255,255,.6);}
		/* Editor body box with a thick coloured left bar on the FIELD itself
		   (beside the content, not the outer section). */
		.jd-styled-form .form-section .ql-container{
			border:1px solid #e3e9ee;border-radius:6px;background:#fff;
			box-shadow:0 1px 2px rgba(15,23,42,.04);}
		.jd-styled-form [data-fieldname="job_summary"] .ql-container{border-left:12px solid #d98c33;}
		.jd-styled-form [data-fieldname="roles_responsibilities"] .ql-container{border-left:12px solid #007ba7;}
		.jd-styled-form [data-fieldname="educational_qualification"] .ql-container{border-left:12px solid #007ba7;}
		.jd-styled-form [data-fieldname="work_experience"] .ql-container{border-left:12px solid #d98c33;}
		.jd-styled-form [data-fieldname="mandatory_training_certification"] .ql-container{border-left:12px solid #00334e;}
		/* Responsive: tighten spacing and bars on small screens */
		@media (max-width:767px){
			.jd-styled-form .form-section{padding:0 12px 12px;}
			.jd-styled-form .form-section .section-head[data-jd-num]{margin:0 -12px 12px;font-size:13px;}
			.jd-styled-form .form-section .section-head[data-jd-num]::before{width:38px;font-size:14px;margin:-11px 12px -11px 0;}
			.jd-styled-form .form-section .ql-container{border-left-width:8px !important;}
			.jd-styled-form [data-fieldname="position_title"] .control-value,
			.jd-styled-form [data-fieldname="position_title"] .like-disabled-input,
			.jd-styled-form [data-fieldname="position_title"] .control-input input{font-size:14px;padding:12px 16px;}
		}
	`;
	const style = document.createElement("style");
	style.id = "jd-form-style";
	style.textContent = css;
	document.head.appendChild(style);
}

// Number the labelled sections (2, 3, 4 …). The Job Information section (1)
// is rendered inside the preview HTML, so its form head is hidden but still
// counts toward the sequence. The coloured accent bars live on the field
// content boxes (see CSS), not on the outer sections.
function number_sections(frm) {
	let n = 0;
	(frm.layout.sections || []).forEach((sec) => {
		const fieldname = sec.df && sec.df.fieldname;
		const head = $(sec.wrapper).find("> .section-head").first();
		if (fieldname === "job_information_section") {
			$(sec.wrapper).addClass("jd-info-section");
			n += 1; // counts as section 1, supplied by the preview
			return;
		}
		const label = (sec.df && sec.df.label) || head.text().trim();
		if (!label) return; // skip unlabelled / structural sections
		n += 1;
		head.attr("data-jd-num", n);
	});
}

function render_previews(frm) {
	const info_field = frm.get_field("job_info_preview");
	const comp_field = frm.get_field("competency_preview");

	if (!frm.doc.position_title) {
		info_field.$wrapper.html(
			`<div class="text-muted" style="padding:12px;">${__("Select a position to load its job information.")}</div>`,
		);
		comp_field.$wrapper.empty();
		return;
	}

	frappe.call({
		method: "hrms.organization_structure.doctype.job_description.job_description.sync_from_position",
		args: { position: frm.doc.position_title },
		callback: (r) => {
			if (!r.message) return;
			info_field.$wrapper.html(r.message.job_info_html || "");
			comp_field.$wrapper.html(r.message.competency_html || "");
			bind_competency_links(frm, comp_field.$wrapper);
		},
	});
}

// Clicking a competency (title or level) opens the position's Competency
// Dictionary so the user can view the full details there.
function bind_competency_links(frm, $wrapper) {
	$wrapper.off("click.jdcomp").on("click.jdcomp", "[data-jd-comp]", function (e) {
		e.preventDefault();
		if (!frm.doc.position_title) return;
		frappe.set_route("Form", "Competency Dictionary", frm.doc.position_title);
	});
}
