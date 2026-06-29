# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import cint, escape_html

# Position org-unit fields rendered in Section 1 (Job Information), in display order.
ORG_UNIT_FIELDS = (
	("org_function", "Function"),
	("org_process", "Process"),
	("org_sub_process", "Sub-Process"),
	("org_department", "Department"),
	("org_district", "District"),
	("org_team", "Team"),
	("org_branch", "Branch"),
	("org_sub_team", "Sub-Team"),
)

LEVEL_LABELS = {1: "Novice", 2: "Intermediate", 3: "Proficient", 4: "Advanced", 5: "Expert"}

# Competency Dictionary Item fields holding each proficiency level's description.
LEVEL_FIELDS = {
	1: "level_1_novice",
	2: "level_2_intermediate",
	3: "level_3_proficient",
	4: "level_4_advanced",
	5: "level_5_expert",
}


class JobDescription(Document):
	def validate(self):
		self.ensure_one_per_position()

	def ensure_one_per_position(self):
		"""Belt-and-braces guard on top of the unique index on position_title."""
		if not self.position_title:
			return
		existing = frappe.db.get_value(
			"Job Description",
			{"position_title": self.position_title, "name": ("!=", self.name or "")},
			"name",
		)
		if existing:
			frappe.throw(
				_("A Job Description already exists for position {0}: {1}").format(
					frappe.bold(self.position_title), frappe.bold(existing)
				)
			)

	def get_print_html(self) -> str:
		"""Full formatted document, used by the 'Job Description' print format."""
		return render_print_html(self)


# ---------------------------------------------------------------------------
# Read-only contracts for Position (organogram) and Competency Dictionary.
# Job Description owns no organogram/competency data; it reads both at runtime
# so those modules can evolve independently.
# ---------------------------------------------------------------------------


def _unit_name(value: str | None) -> str | None:
	if not value:
		return None
	return frappe.db.get_value("Organization Unit", value, "unit_name") or value


def format_job_location(pos: dict) -> str:
	"""Resolve the Position's location into a readable label."""
	location = pos.get("location_1")
	if location == "District Office":
		return _unit_name(pos.get("org_district")) or "District Office"
	if location == "Branch":
		return _unit_name(pos.get("org_branch")) or "Branch"
	if location == "Head Office":
		return "Head Office"
	return location or "-"


def get_position_context(position: str | None) -> dict:
	"""Section 1 (Job Information) data read from a Position."""
	if not position:
		return {}

	fields = [
		"position_name",
		"job_category",
		"job_grade",
		"location_1",
		"parent_position",
		*[fieldname for fieldname, _label in ORG_UNIT_FIELDS],
	]
	pos = frappe.db.get_value("Position", position, fields, as_dict=True)
	if not pos:
		return {}

	reports_to = None
	if pos.parent_position:
		reports_to = (
			frappe.db.get_value("Position", pos.parent_position, "position_name") or pos.parent_position
		)

	info = {
		"position_name": pos.position_name or position,
		"job_category": pos.job_category,
		"job_grade": pos.job_grade,
		"job_location": format_job_location(pos),
		"reports_to": reports_to,
	}
	for fieldname, _label in ORG_UNIT_FIELDS:
		info[fieldname] = _unit_name(pos.get(fieldname))
	return info


def _leveled(row) -> dict:
	level = cint(row.required_proficiency_level)
	levels = [
		{
			"level": n,
			"label": LEVEL_LABELS.get(n, ""),
			"description": (row.get(LEVEL_FIELDS[n]) or "").strip(),
		}
		for n in range(1, 6)
	]
	return {
		"competency": row.competency,
		"definition": row.definition,
		"required_proficiency_level": level,
		"required_proficiency_label": LEVEL_LABELS.get(level, ""),
		"levels": levels,
	}


def get_competency_context(position: str | None) -> dict:
	"""Section 4 (Required Competencies) read from the position's Competency Dictionary.

	Competency Dictionary is autonamed by ``job_position`` so its name == position name.
	"""
	empty = {"core": [], "functional": [], "leadership": [], "show_leadership": False, "exists": False}
	if not position:
		return empty

	name = frappe.db.exists("Competency Dictionary", position)
	if not name:
		return empty

	doc = frappe.get_doc("Competency Dictionary", name)
	show_leadership = bool(doc.requires_leadership_competency)
	return {
		"core": [{"competency": r.competency, "definition": r.definition} for r in doc.core_competencies],
		"functional": [_leveled(r) for r in doc.functional_competencies],
		"leadership": [_leveled(r) for r in doc.leadership_competencies] if show_leadership else [],
		"show_leadership": show_leadership,
		"exists": True,
	}


# ---------------------------------------------------------------------------
# Preview rendering (Section 1 + Section 4 HTML fields on the form).
# ---------------------------------------------------------------------------


def _hint(message: str) -> str:
	return f"<div class='text-muted' style='padding:12px;'>{escape_html(message)}</div>"


def _cell(value: object) -> str:
	text = str(value).strip() if value not in (None, "") else "-"
	return escape_html(text)


JD_INFO_STYLE = """
<style>
.jd-info-card{overflow:hidden;background:#f0f4f7;font-size:13px;}
.jd-sec-bar{display:flex;align-items:stretch;background:#d9edf7;}
.jd-sec-num{background:#0099cc;color:#fff;min-width:46px;display:flex;align-items:center;
justify-content:center;font-weight:700;font-size:15px;}
.jd-sec-title{padding:11px 16px;color:#004b87;font-weight:700;font-size:14px;}
.jd-info-table{width:100%;border-collapse:collapse;background:#f0f4f7;table-layout:fixed;}
.jd-info-table th,.jd-info-table td{border:1px solid #d8e3ec;padding:12px 16px;
vertical-align:top;text-align:left;word-break:break-word;}
.jd-info-table th.jd-il{width:16%;color:#008cba;font-weight:700;background:#f0f4f7;}
.jd-info-table td.jd-iv{width:34%;color:#1f2937;background:#fff;}
.jd-info-table td.jd-iv.is-empty{color:#9aa7b2;}
@media (max-width:767px){
.jd-info-table,.jd-info-table tbody,.jd-info-table tr{display:block;width:100%;}
.jd-info-table th.jd-il,.jd-info-table td.jd-iv{display:block;width:100% !important;
border:0;border-bottom:1px solid #e3e9ee;}
.jd-info-table th.jd-il{background:#eef4f8;padding-bottom:3px;}
.jd-info-table td.jd-iv{padding-top:3px;}
}
</style>
"""


def _val_cell(value: object) -> str:
	is_empty = value in (None, "") or str(value).strip() in ("", "-")
	cls = "jd-iv is-empty" if is_empty else "jd-iv"
	text = "—" if is_empty else _cell(value)
	return f"<td class='{cls}'>{text}</td>"


def render_job_info_html(info: dict) -> str:
	if not info:
		return _hint(_("Select a position to load its job information."))

	# Two fixed columns, each row pairs left[i] with right[i].
	left = [
		(_("Position Title"), info.get("position_name")),
		(_("Job Grade"), info.get("job_grade")),
		(_("Job Category"), info.get("job_category")),
		(_("Job Location"), info.get("job_location")),
		(_("Function"), info.get("org_function")),
	]
	right = [
		(_("Process"), info.get("org_process")),
		(_("Sub-Process"), info.get("org_sub_process")),
		(_("Department"), info.get("org_department")),
		(_("Team"), info.get("org_team")),
		(_("Reports to"), info.get("reports_to")),
	]

	rows = []
	for i in range(max(len(left), len(right))):
		l_label, l_value = left[i] if i < len(left) else ("", None)
		r_label, r_value = right[i] if i < len(right) else ("", None)
		rows.append(
			f"<tr><th class='jd-il'>{_cell(l_label)}</th>{_val_cell(l_value)}"
			f"<th class='jd-il'>{_cell(r_label)}</th>{_val_cell(r_value)}</tr>"
		)

	return (
		f"{JD_INFO_STYLE}<div class='jd-info-card'>"
		"<div class='jd-sec-bar'><div class='jd-sec-num'>1</div>"
		f"<div class='jd-sec-title'>{_cell(_('Job Information'))}</div></div>"
		f"<table class='jd-info-table'><tbody>{''.join(rows)}</tbody></table>"
		"</div>"
	)


JD_COMP_STYLE = """
<style>
.jd-comp{font-size:13px;}
.jd-sub-bar{background:#d9edf7;color:#004b87;font-weight:700;font-size:13.5px;
padding:11px 16px;margin:16px 0 3px;border-radius:4px;}
.jd-core-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));
gap:3px;background:#fff;}
.jd-core-pill{display:flex;align-items:center;justify-content:center;text-align:center;
background:#eef6fc;color:#003b49;font-weight:600;padding:16px 10px;border:1px solid #b8d4ea;
text-decoration:none;cursor:pointer;transition:background .12s ease;}
.jd-core-pill:hover{background:#d9edf7;color:#004b87;text-decoration:none;}
.jd-comp-table{width:100%;border-collapse:collapse;margin-top:3px;}
.jd-comp-table th.jd-fh{background:#00334e;color:#fff;font-weight:700;text-align:left;
padding:13px 16px;font-size:13.5px;}
.jd-comp-table th.jd-fh-lvl{width:34%;}
.jd-comp-table td{border:1px solid #b8d4ea;padding:12px 16px;vertical-align:top;
word-break:break-word;}
.jd-comp-table tr.alt{background:#eef6fc;}
.jd-comp-table .jd-link{color:#004b87;font-weight:700;text-decoration:none;cursor:pointer;}
.jd-comp-table td:last-child .jd-link{color:#007ba7;}
.jd-comp-table .jd-link:hover{text-decoration:underline;}
@media (max-width:767px){
.jd-core-grid{grid-template-columns:1fr 1fr;}
.jd-comp-table th.jd-fh-lvl{width:40%;}
}
</style>
"""


def _core_grid(core: list) -> str:
	cells = "".join(
		f"<a href='#' class='jd-core-pill' data-jd-comp='core' data-jd-idx='{i}'>"
		f"{_cell(c.get('competency'))}</a>"
		for i, c in enumerate(core)
	)
	return f"<div class='jd-core-grid'>{cells}</div>"


def _leveled_table(rows: list, first_label: str, kind: str) -> str:
	header = (
		f"<tr><th class='jd-fh'>{_cell(first_label)}</th>"
		f"<th class='jd-fh jd-fh-lvl'>{_cell(_('Required Proficiency Level'))}</th></tr>"
	)
	lines = []
	for i, row in enumerate(rows):
		alt = " class='alt'" if i % 2 else ""
		level = row.get("required_proficiency_level")
		label = row.get("required_proficiency_label")
		if level and label:
			level_text = f"{_('Level')} {level} – {label}"
		elif level:
			level_text = f"{_('Level')} {level}"
		else:
			level_text = "—"
		comp_link = (
			f"<a href='#' class='jd-link' data-jd-comp='{kind}' data-jd-idx='{i}'>"
			f"{_cell(row.get('competency'))}</a>"
		)
		level_link = (
			f"<a href='#' class='jd-link' data-jd-comp='{kind}' data-jd-idx='{i}'>"
			f"{_cell(level_text)}</a>"
		)
		lines.append(f"<tr{alt}><td>{comp_link}</td><td>{level_link}</td></tr>")
	return (
		f"<table class='jd-comp-table'><thead>{header}</thead>"
		f"<tbody>{''.join(lines)}</tbody></table>"
	)


def render_competency_html(ctx: dict) -> str:
	if not ctx.get("exists"):
		return _hint(_("No Competency Dictionary found for this position."))

	blocks = []
	core = ctx.get("core") or []
	if core:
		blocks.append(f"<div class='jd-sub-bar'>{_cell(_('Core Competencies'))}</div>{_core_grid(core)}")

	functional = ctx.get("functional") or []
	if functional:
		blocks.append(
			f"<div class='jd-sub-bar'>{_cell(_('Functional Competencies'))}</div>"
			f"{_leveled_table(functional, _('Functional Competency'), 'functional')}"
		)

	if ctx.get("show_leadership"):
		leadership = ctx.get("leadership") or []
		if leadership:
			blocks.append(
				f"<div class='jd-sub-bar'>{_cell(_('Leadership Competencies'))}</div>"
				f"{_leveled_table(leadership, _('Leadership Competency'), 'leadership')}"
			)

	body = "".join(blocks)
	if not body:
		return _hint(_("This position's Competency Dictionary has no competencies yet."))
	return f"{JD_COMP_STYLE}<div class='jd-comp'>{body}</div>"


# ---------------------------------------------------------------------------
# Print Format rendering (full formatted document, no edit controls).
# ---------------------------------------------------------------------------


PRINT_STYLE = """
<style>
.jd-print{color:#1f2937;font-size:12.5px;line-height:1.55;}
.jd-print-head{display:flex;align-items:center;justify-content:space-between;gap:16px;
border-bottom:3px solid #c9a227;padding-bottom:10px;margin-bottom:18px;}
.jd-bank{color:#00838f;font-size:20px;font-weight:700;}
.jd-doc-title{color:#00a0e9;font-size:20px;font-weight:700;text-align:right;}
.jd-ptitle-bar{background:#00334e;color:#fff;font-weight:700;font-size:15px;
padding:14px 20px;border-radius:4px;margin:0 0 14px;}
.jd-psec{margin-top:18px;}
.jd-summary{background:#f0f4f7;padding:14px 18px;border-radius:0 4px 4px 0;
border-left:8px solid #d98c33;margin-top:6px;}
.jd-qblock{background:#f7fafc;padding:8px 16px;margin:8px 0 0;page-break-inside:avoid;}
.jd-qtitle{font-weight:700;font-size:13.5px;margin-bottom:4px;}
.jd-print ul{margin:4px 0;padding-left:20px;}
</style>
"""


def _section_bar(num: int, title: str) -> str:
	return (
		"<div class='jd-sec-bar jd-psec'>"
		f"<div class='jd-sec-num'>{num}</div>"
		f"<div class='jd-sec-title'>{_cell(title)}</div></div>"
	)


def _is_role_title(node) -> bool:
	"""A heading tag, or a paragraph whose whole text is bold, starts a new group."""
	name = getattr(node, "name", None)
	if name in ("h1", "h2", "h3", "h4", "h5", "h6"):
		return True
	if name == "p":
		text = node.get_text(strip=True)
		if not text:
			return False
		bold = node.find(["strong", "b"])
		return bool(bold) and bold.get_text(strip=True) == text
	return False


def _split_roles(html: str) -> list:
	"""Split the Roles rich text into [{title, body}] groups, one per heading."""
	from bs4 import BeautifulSoup

	soup = BeautifulSoup(html or "", "html.parser")
	# The Text Editor wraps content in <div class="ql-editor ...">; descend into it.
	container = soup.find("div", class_="ql-editor") or soup
	groups: list = []
	current: dict | None = None
	for node in container.children:
		name = getattr(node, "name", None)
		if name is None:  # bare text node
			text = str(node).strip()
			if not text:
				continue
			content = f"<p>{escape_html(text)}</p>"
		elif _is_role_title(node):
			if current is not None:
				groups.append(current)
			current = {"title": node.get_text(strip=True), "body": ""}
			continue
		else:
			# skip Quill's empty filler paragraphs (<p><br></p>)
			if name == "p" and not node.get_text(strip=True) and not node.find("img"):
				continue
			content = str(node)
		if current is None:
			current = {"title": "", "body": ""}
		current["body"] += content
	if current is not None:
		groups.append(current)
	return groups


JD_ROLES_STYLE = """
<style>
.jd-roles .jd-rgroup{background:#fff;padding:8px 16px;margin:0 0 10px;
border-radius:0 4px 4px 0;page-break-inside:avoid;}
.jd-roles .jd-rtitle{color:#003366;font-weight:700;font-size:13.5px;margin-bottom:4px;}
.jd-roles ul,.jd-roles ol{margin:4px 0;padding-left:20px;}
</style>
"""


def render_roles_html(html: str) -> str:
	"""Each responsibility group gets a thick left bar, alternating teal / orange."""
	groups = _split_roles(html)
	if not groups:
		return ""
	colors = ("#007ba7", "#d98c33")
	blocks = []
	for i, group in enumerate(groups):
		title = f"<div class='jd-rtitle'>{escape_html(group['title'])}</div>" if group["title"] else ""
		blocks.append(
			f"<div class='jd-rgroup' style='border-left:10px solid {colors[i % 2]};'>{title}{group['body']}</div>"
		)
	return f"{JD_ROLES_STYLE}<div class='jd-roles'>{''.join(blocks)}</div>"


def render_qualifications_html(doc) -> str:
	"""Three qualification blocks: Education (teal), Work Experience (orange), Certification (navy)."""
	items = (
		(_("Educational Qualification"), doc.educational_qualification, "#007ba7", "#007ba7"),
		(_("Work Experience"), doc.work_experience, "#d98c33", "#004b87"),
		(_("Mandatory Training / Certification"), doc.mandatory_training_certification, "#00334e", "#003366"),
	)
	blocks = []
	for title, body, bar, title_color in items:
		if not body:
			continue
		blocks.append(
			f"<div class='jd-qblock' style='border-left:6px solid {bar};'>"
			f"<div class='jd-qtitle' style='color:{title_color};'>{escape_html(title)}</div>"
			f"{body}</div>"
		)
	return "".join(blocks)


def render_print_html(doc) -> str:
	info = get_position_context(doc.position_title)
	competency = get_competency_context(doc.position_title)
	position_name = info.get("position_name") or doc.position_title or ""

	parts = [
		PRINT_STYLE,
		"<div class='jd-print'>",
		"<div class='jd-print-head'>",
		f"<div class='jd-bank'>{_cell('Cooperative Bank of Oromia')}</div>",
		f"<div class='jd-doc-title'>{_cell(_('Job Description'))}</div>",
		"</div>",
		f"<div class='jd-ptitle-bar'>{_cell(position_name)}</div>",
		render_job_info_html(info),
		_section_bar(2, _("Job Summary")),
		f"<div class='jd-summary'>{doc.job_summary or ''}</div>",
		_section_bar(3, _("Roles and Responsibilities")),
		render_roles_html(doc.roles_responsibilities),
		_section_bar(4, _("Required Competencies")),
		render_competency_html(competency),
		_section_bar(5, _("Required Qualifications")),
		render_qualifications_html(doc),
		"</div>",
	]
	return "".join(parts)


# ---------------------------------------------------------------------------
# Whitelisted API used by the form to render the live previews.
# ---------------------------------------------------------------------------


@frappe.whitelist()
def sync_from_position(position: str | None = None) -> dict:
	"""Return Section 1 + Section 4 context (and rendered HTML) for a Position."""
	info = get_position_context(position)
	competency = get_competency_context(position)
	return {
		"job_info": info,
		"job_info_html": render_job_info_html(info),
		"competency": competency,
		"competency_html": render_competency_html(competency),
	}
