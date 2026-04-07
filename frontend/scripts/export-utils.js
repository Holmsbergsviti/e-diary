/* ================================================================
   export-utils.js – Client-side CSV & Excel export helpers
   Requires SheetJS (xlsx) loaded via CDN for Excel support.
   ================================================================ */

/**
 * Trigger a file download in the browser.
 * @param {string} filename
 * @param {Blob} blob
 */
function _downloadBlob(filename, blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
}

/**
 * Export an array of objects as a CSV file.
 * @param {string} filename  – e.g. "students.csv"
 * @param {object[]} rows    – array of flat objects
 * @param {string[]} [columns] – ordered column keys (defaults to all keys of first row)
 * @param {object} [headerMap] – { key: "Display Header" } mapping
 */
function exportCSV(filename, rows, columns, headerMap) {
    if (!rows || rows.length === 0) { showToast("Nothing to export", "warning"); return; }
    const cols = columns || Object.keys(rows[0]);
    const hMap = headerMap || {};
    const header = cols.map(c => hMap[c] || c);

    const escape = v => {
        if (v == null) return "";
        const s = String(v);
        return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s.replace(/"/g, '""')}"` : s;
    };

    const lines = [header.map(escape).join(",")];
    for (const row of rows) {
        lines.push(cols.map(c => escape(row[c])).join(","));
    }
    const blob = new Blob(["\uFEFF" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    _downloadBlob(filename, blob);
    showToast(`Exported ${rows.length} rows`, "success");
}

/**
 * Export an array of objects as an Excel (.xlsx) file.
 * Falls back to CSV if SheetJS is not loaded.
 * @param {string} filename   – e.g. "students.xlsx"
 * @param {object[]} rows
 * @param {string[]} [columns]
 * @param {object} [headerMap]
 * @param {string} [sheetName]
 */
function exportExcel(filename, rows, columns, headerMap, sheetName) {
    if (typeof XLSX === "undefined") {
        showToast("Excel library not loaded, exporting CSV instead", "warning");
        exportCSV(filename.replace(/\.xlsx$/, ".csv"), rows, columns, headerMap);
        return;
    }
    if (!rows || rows.length === 0) { showToast("Nothing to export", "warning"); return; }
    const cols = columns || Object.keys(rows[0]);
    const hMap = headerMap || {};
    const headers = cols.map(c => hMap[c] || c);

    const aoaData = [headers];
    for (const row of rows) {
        aoaData.push(cols.map(c => row[c] != null ? row[c] : ""));
    }

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(aoaData);

    // Auto-width columns
    ws["!cols"] = cols.map((_, i) => {
        let max = headers[i].length;
        for (const r of aoaData) { if (r[i] != null && String(r[i]).length > max) max = String(r[i]).length; }
        return { wch: Math.min(max + 2, 50) };
    });

    XLSX.utils.book_append_sheet(wb, ws, sheetName || "Sheet1");
    const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    _downloadBlob(filename, blob);
    showToast(`Exported ${rows.length} rows`, "success");
}

/**
 * Export multiple sheets into one Excel workbook.
 * @param {string} filename
 * @param {{ name: string, rows: object[], columns?: string[], headerMap?: object }[]} sheets
 */
function exportExcelMultiSheet(filename, sheets) {
    if (typeof XLSX === "undefined") {
        showToast("Excel library not loaded", "warning");
        return;
    }
    const wb = XLSX.utils.book_new();
    let totalRows = 0;
    for (const sheet of sheets) {
        const rows = sheet.rows || [];
        if (rows.length === 0) continue;
        const cols = sheet.columns || Object.keys(rows[0]);
        const hMap = sheet.headerMap || {};
        const headers = cols.map(c => hMap[c] || c);
        const aoaData = [headers];
        for (const row of rows) {
            aoaData.push(cols.map(c => row[c] != null ? row[c] : ""));
        }
        const ws = XLSX.utils.aoa_to_sheet(aoaData);
        ws["!cols"] = cols.map((_, i) => {
            let max = headers[i].length;
            for (const r of aoaData) { if (r[i] != null && String(r[i]).length > max) max = String(r[i]).length; }
            return { wch: Math.min(max + 2, 50) };
        });
        XLSX.utils.book_append_sheet(wb, ws, sheet.name.substring(0, 31));
        totalRows += rows.length;
    }
    if (totalRows === 0) { showToast("Nothing to export", "warning"); return; }
    const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    _downloadBlob(filename, blob);
    showToast(`Exported ${totalRows} rows`, "success");
}

/**
 * Build an export dropdown button (CSV + Excel).
 * @param {string} label  – button text, e.g. "Export"
 * @param {Function} onCSV
 * @param {Function} onExcel
 * @returns {string} HTML string
 */
function exportDropdownHTML(id, label) {
    return `<div class="export-dropdown" id="${id}">
        <button class="btn btn-sm btn-outline" onclick="toggleExportMenu('${id}')">${label || "⬇ Export"}</button>
        <div class="export-menu" style="display:none;">
            <button onclick="document.dispatchEvent(new CustomEvent('export',{detail:{id:'${id}',fmt:'csv'}}))">📄 CSV</button>
            <button onclick="document.dispatchEvent(new CustomEvent('export',{detail:{id:'${id}',fmt:'xlsx'}}))">📊 Excel</button>
        </div>
    </div>`;
}

function toggleExportMenu(id) {
    const menu = document.querySelector(`#${id} .export-menu`);
    if (!menu) return;
    const isVisible = menu.style.display !== "none";
    // Close all other menus first
    document.querySelectorAll(".export-menu").forEach(m => m.style.display = "none");
    menu.style.display = isVisible ? "none" : "block";
}

// Close export menus when clicking outside
document.addEventListener("click", (e) => {
    if (!e.target.closest(".export-dropdown")) {
        document.querySelectorAll(".export-menu").forEach(m => m.style.display = "none");
    }
});
