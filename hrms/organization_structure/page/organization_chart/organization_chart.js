frappe.pages["organization-chart"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: __("Organization Chart"),
		single_column: true,
	});

	frappe.breadcrumbs.add("Organization Structure");

	// Mount the controls in the page header row, beside the search; fall back to
	// the page body if the head content isn't available.
	const $head = $(page.wrapper).find(".page-head-content");
	const $toolbar = $('<div class="os-toolbar"></div>');
	$toolbar.appendTo($head.length ? $head : page.body);

	const $container = $('<div class="os-chart"></div>').appendTo(page.body);

	// Frappe's global navbar search ("Search  Ctrl+K"). We relocate it into this
	// page's header group while the page is open and restore it on leaving, so it
	// is not lost from the navbar on other pages.
	let $globalSearch = null;
	let $searchHome = null;

	function ensure_search_ref() {
		if ($globalSearch) return;
		$globalSearch = $("header .search-bar, .navbar .search-bar").first();
		if ($globalSearch.length) {
			$searchHome = $('<span class="os-search-home"></span>').insertBefore($globalSearch);
		}
	}

	function move_search_into_toolbar() {
		ensure_search_ref();
		if (!$globalSearch || !$globalSearch.length) return;
		const $slot = $toolbar.find(".os-search-slot");
		if ($slot.length) $globalSearch.appendTo($slot).addClass("os-search-moved");
	}

	function restore_search() {
		if ($globalSearch && $globalSearch.length && $searchHome && $searchHome.length) {
			$globalSearch.removeClass("os-search-moved").insertAfter($searchHome);
		}
	}

	const UNIT_META = {
		Executive: { abbr: "exe", type_class: "os-type-executive", color: "#2ca8ff" },
		Function: { abbr: "func", type_class: "os-type-function", color: "#ef6c00" },
		Process: { abbr: "proc", type_class: "os-type-process", color: "#2e7d32" },
		"Sub-Process": { abbr: "subp", type_class: "os-type-sub-process", color: "#f9a825" },
		Department: { abbr: "dept", type_class: "os-type-dept-district", color: "#1565c0" },
		District: { abbr: "dis", type_class: "os-type-dept-district", color: "#1565c0" },
		Team: { abbr: "team", type_class: "os-type-team-branch", color: "#212121" },
		Branch: { abbr: "br", type_class: "os-type-team-branch", color: "#212121" },
		"Sub-Team": { abbr: "subt", type_class: "os-type-sub-team", color: "#6d4c41" },
		Other: { abbr: "oth", type_class: "os-type-other", color: "#c9a227" },
	};

	function unit_meta(unit_type) {
		return UNIT_META[unit_type] || { abbr: "unit", type_class: "os-type-unknown", color: "#90a4ae" };
	}

	function load() {
		$container.html(`<div class="os-empty text-muted">${__("Loading...")}</div>`);
		$toolbar.empty();
		frappe
			.call({
				method: "hrms.organization_structure.page.organization_chart.organization_chart.get_chart_data",
			})
			.then((r) => render(r.message || []));
	}

	function render(roots) {
		if (!roots.length) {
			$container.html(
				`<div class="os-empty text-muted">${__(
					"No organization units found. Create organization units to see the chart.",
				)}</div>`,
			);
			$toolbar.empty();
			return;
		}

		const html = `<div class="os-tree-wrap"><ul class="os-tree">${roots
			.map(node_html)
			.join("")}</ul></div>`;
		$container.html(html);

		inject_toggles();
		bind_node_clicks();
		build_controls(collect_unit_types(roots));
	}

	function bind_node_clicks() {
		$container.find(".os-node[data-doctype='Organization Unit']").on("click", function () {
			const id = $(this).data("id");
			if (id) frappe.set_route("Form", "Organization Unit", id);
		});

		$container.find(".os-node[data-doctype='Position']").on("click", function () {
			const id = $(this).data("id");
			if (id) frappe.set_route("Form", "Position", id);
		});
	}

	/* ---------- collapse / expand ---------- */

	// Insert a toggle button into every <li> that has a child subtree.
	function inject_toggles() {
		$container.find(".os-tree li").each(function () {
			const $li = $(this);
			const $childUl = $li.children("ul").first();
			if ($childUl.length) {
				$('<button class="os-toggle" type="button" aria-label="Toggle"></button>')
					.text("−") // minus
					.insertBefore($childUl);
			}
		});

		$container.find(".os-toggle").on("click", function (e) {
			e.stopPropagation();
			const $li = $(this).closest("li");
			set_collapsed($li, !$li.hasClass("collapsed"));
		});
	}

	function set_collapsed($li, collapsed) {
		$li.toggleClass("collapsed", collapsed);
		$li.children(".os-toggle").text(collapsed ? "+" : "−");
	}

	function branch_items() {
		return $container.find(".os-tree li").filter(function () {
			return $(this).children("ul").length > 0;
		});
	}

	function collapse_all() {
		branch_items().each(function () {
			set_collapsed($(this), true);
		});
	}

	function expand_all() {
		branch_items().each(function () {
			set_collapsed($(this), false);
		});
	}

	// Collapse everything, then expand only the branches leading to (and below)
	// units whose unit_type is selected.
	function expand_by_types(types) {
		$container.find(".os-node").removeClass("os-match");

		if (!types.length) {
			expand_all();
			return;
		}

		collapse_all();
		$container.find(".os-node[data-doctype='Organization Unit']").each(function () {
			const $node = $(this);
			if (types.indexOf($node.attr("data-unit-type") || "") === -1) return;

			$node.addClass("os-match");
			// Reveal this node and its descendants: expand its own <li> and all ancestors.
			$node.parents("li").each(function () {
				set_collapsed($(this), false);
			});
		});
	}

	/* ---------- right-side controls ---------- */

	function collect_unit_types(nodes, set) {
		set = set || new Set();
		(nodes || []).forEach((n) => {
			if (n.unit_type) set.add(n.unit_type);
			collect_unit_types(n.children || [], set);
		});
		// Stable order: known types first (in UNIT_META order), then any extras.
		const known = Object.keys(UNIT_META).filter((t) => set.has(t));
		const extras = [...set].filter((t) => !UNIT_META[t]);
		return [...known, ...extras];
	}

	function build_controls(types) {
		const esc = frappe.utils.escape_html;
		const options = types
			.map((t) => {
				const meta = unit_meta(t);
				return `<label class="os-type-option">
					<input type="checkbox" value="${esc(t)}">
					<span class="os-type-swatch" style="background:${meta.color}"></span>
					<span class="os-type-label">${esc(t)}</span>
				</label>`;
			})
			.join("");

		$toolbar.html(`
			<div class="os-dropdown-wrap">
				<button class="btn btn-default btn-sm os-dropdown-toggle" type="button">
					<span class="os-dropdown-count-text">${__("Expand by Unit Type")}</span>
					<span class="caret"></span>
				</button>
				<div class="os-dropdown">
					<input type="text" class="form-control input-sm os-type-search"
						placeholder="${__("Search unit type...")}">
					<div class="os-type-options">${
						options || `<div class="text-muted small">${__("No unit types")}</div>`
					}</div>
					<div class="os-panel-actions">
						<button class="btn btn-xs btn-default os-expand-all">${__("Expand all")}</button>
						<button class="btn btn-xs btn-default os-collapse-all">${__("Collapse all")}</button>
						<button class="btn btn-xs btn-default os-clear-types">${__("Clear")}</button>
					</div>
				</div>
			</div>
			<span class="os-search-slot"></span>
			<button class="btn btn-default btn-sm os-refresh" type="button">${__("Refresh")}</button>
		`);

		$toolbar.find(".os-refresh").on("click", load);
		move_search_into_toolbar();

		const $wrap = $toolbar.find(".os-dropdown-wrap");
		const $toggle = $wrap.find(".os-dropdown-toggle");
		const $label = $wrap.find(".os-dropdown-count-text");

		const selected_types = () =>
			$wrap
				.find(".os-type-options input:checked")
				.map(function () {
					return this.value;
				})
				.get();

		const update_label = () => {
			const n = selected_types().length;
			$label.text(n ? __("Unit Type ({0})", [n]) : __("Expand by Unit Type"));
			$toggle.toggleClass("active", n > 0);
		};

		// open / close the dropdown
		$toggle.on("click", (e) => {
			e.stopPropagation();
			$wrap.toggleClass("open");
		});
		// keep clicks inside the menu from closing it
		$wrap.find(".os-dropdown").on("click", (e) => e.stopPropagation());
		// close on outside click (re-bind cleanly to avoid stacking across renders)
		$(document).off("click.os_chart").on("click.os_chart", () => $wrap.removeClass("open"));

		$wrap.find(".os-type-options input").on("change", () => {
			expand_by_types(selected_types());
			update_label();
		});

		$wrap.find(".os-type-search").on("input", function () {
			const q = (this.value || "").toLowerCase();
			$wrap.find(".os-type-option").each(function () {
				const text = $(this).find(".os-type-label").text().toLowerCase();
				$(this).toggle(text.indexOf(q) !== -1);
			});
		});

		$wrap.find(".os-expand-all").on("click", () => {
			$wrap.find(".os-type-options input").prop("checked", false);
			$container.find(".os-node").removeClass("os-match");
			expand_all();
			update_label();
		});

		$wrap.find(".os-collapse-all").on("click", () => {
			$wrap.find(".os-type-options input").prop("checked", false);
			$container.find(".os-node").removeClass("os-match");
			collapse_all();
			update_label();
		});

		$wrap.find(".os-clear-types").on("click", () => {
			$wrap.find(".os-type-options input").prop("checked", false);
			$wrap.find(".os-type-search").val("").trigger("input");
			expand_by_types([]);
			update_label();
		});
	}

	/* ---------- node rendering ---------- */

	function position_node_html(p) {
		const esc = frappe.utils.escape_html;
		const child_positions =
			p.children && p.children.length
				? `<ul class="os-position-tree">${p.children.map(position_node_html).join("")}</ul>`
				: "";

		// Name is shown once in the header; the body only carries the holder /
		// vacancy status so the box is not duplicated.
		const body = p.occupied
			? `<div class="os-emp">${esc(p.employee || "")}</div>`
			: `<div class="os-pos os-vac">${__("Vacant")}</div>`;

		return `<li>
			<div class="os-node os-node-position ${p.occupied ? "occupied" : "vacant"}"
				data-id="${esc(p.id)}" data-doctype="Position">
				<div class="os-head os-head-position">
					<span class="os-abbr">pos</span>
					<span class="os-unit-name">${esc(p.title || "")}</span>
				</div>
				<div class="os-body">${body}</div>
			</div>
			${child_positions}
		</li>`;
	}

	function node_html(n) {
		const esc = frappe.utils.escape_html;
		const meta = unit_meta(n.unit_type);
		const head = `<span class="os-abbr">${esc(meta.abbr)}</span>
			<span class="os-unit-name">${esc(n.unit || "")}</span>`;

		let body;
		if (!n.has_head) {
			body = `<div class="os-pos">${esc(n.unit_type || __("Organization Unit"))}</div>`;
		} else if (n.occupied) {
			body = `<div class="os-emp">${esc(n.employee || "")}</div>
				<div class="os-pos">${esc(n.title || "")}</div>`;
		} else {
			body = `<div class="os-emp">${esc(n.title || "")}</div>
				<div class="os-pos os-vac">${__("Vacant")}</div>`;
		}

		// Child units and the unit's own positions are siblings in ONE <ul> so the
		// CSS connectors link every child box back to this unit box.
		const child_html = [
			...(n.children || []).map(node_html),
			...(n.positions || []).map(position_node_html),
		].join("");
		const children = child_html ? `<ul>${child_html}</ul>` : "";

		return `<li>
			<div class="os-node ${n.occupied ? "occupied" : "vacant"} ${meta.type_class}"
				data-id="${esc(n.id)}" data-doctype="Organization Unit"
				data-unit-type="${esc(n.unit_type || "")}">
				<div class="os-head">${head}</div>
				<div class="os-body">${body}</div>
			</div>
			${children}
		</li>`;
	}

	load();
	$(wrapper).bind("show", load);

	// Put the global search back in the navbar when navigating away from this page.
	frappe.router.on("change", () => {
		if (frappe.get_route_str() === "organization-chart") {
			move_search_into_toolbar();
		} else {
			restore_search();
		}
	});
};
