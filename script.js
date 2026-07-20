// PDF Sum Calculator Pro
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

let totalPages = 0;
let currentViewPage = 'all'; // 'all' or page number
let pdfArrayBuffer = null; // Store original PDF ArrayBuffer for saving

// File input handler
document.getElementById('pdfInput').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async () => {
        pdfArrayBuffer = reader.result.slice(0); // Store a copy
        const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(reader.result) }).promise;
        totalPages = pdf.numPages;
        const viewer = document.getElementById('viewer');
        viewer.innerHTML = '';

        for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const scale = Math.min(1.5, (window.innerWidth - 80) / page.getViewport({ scale: 1 }).width);
            const viewport = page.getViewport({ scale });

            const div = document.createElement('div');
            div.className = 'page-container';
            div.dataset.page = i;
            div.dataset.scale = scale;
            div.style.width = viewport.width + 'px';
            div.style.height = viewport.height + 'px';
            div.addEventListener('dblclick', (e) => createInput(e, div));

            // Page label
            const pageLabel = document.createElement('div');
            pageLabel.className = 'page-label';
            pageLabel.textContent = `หน้า ${i}/${pdf.numPages}`;
            div.appendChild(pageLabel);

            // Page total label
            const pageTotalLabel = document.createElement('div');
            pageTotalLabel.className = 'page-total-label';
            pageTotalLabel.id = `page-total-label-${i}`;
            pageTotalLabel.textContent = 'ยอด: 0 บาท';
            div.appendChild(pageTotalLabel);

            // Canvas
            const canvas = document.createElement('canvas');
            canvas.width = viewport.width;
            canvas.height = viewport.height;
            await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
            div.appendChild(canvas);

            viewer.appendChild(div);
        }

        // Enable save buttons
        document.getElementById('saveBtn').disabled = false;
        document.getElementById('saveProjectBtn').disabled = false;

        setupPageNavigation();
        updatePageSummaryBadges();
    };
    reader.readAsArrayBuffer(file);
});

// Save PDF with annotations
document.getElementById('saveBtn').addEventListener('click', async () => {
    if (!pdfArrayBuffer) return;

    const btn = document.getElementById('saveBtn');
    btn.textContent = '⏳ กำลังบันทึก...';
    btn.disabled = true;

    try {
        const { jsPDF } = window.jspdf;

        // Re-render each page at scale 1 for the PDF - use a fresh copy
        const freshData = new Uint8Array(pdfArrayBuffer.slice(0));
        const pdf = await pdfjsLib.getDocument({ data: freshData }).promise;
        const firstPage = await pdf.getPage(1);
        const firstViewport = firstPage.getViewport({ scale: 1 });

        // Create jsPDF with the correct page size
        const doc = new jsPDF({
            orientation: firstViewport.width > firstViewport.height ? 'landscape' : 'portrait',
            unit: 'pt',
            format: [firstViewport.width, firstViewport.height]
        });

        for (let i = 1; i <= pdf.numPages; i++) {
            if (i > 1) {
                const page = await pdf.getPage(i);
                const vp = page.getViewport({ scale: 1 });
                doc.addPage([vp.width, vp.height], vp.width > vp.height ? 'landscape' : 'portrait');
            }

            const page = await pdf.getPage(i);
            const viewport = page.getViewport({ scale: 2 }); // Higher scale for quality
            const canvas = document.createElement('canvas');
            canvas.width = viewport.width;
            canvas.height = viewport.height;
            const ctx = canvas.getContext('2d');
            await page.render({ canvasContext: ctx, viewport }).promise;

            // Draw the input values onto the canvas
            const pageContainer = document.querySelector(`.page-container[data-page="${i}"]`);
            const displayScale = parseFloat(pageContainer.dataset.scale);
            const inputWrappers = pageContainer.querySelectorAll('.input-wrapper');

            inputWrappers.forEach(wrapper => {
                const input = wrapper.querySelector('.input-box');
                const value = input.value;
                if (value && parseFloat(value) !== 0) {
                    // Get position relative to the container
                    const left = parseInt(wrapper.style.left) || 0;
                    const top = parseInt(wrapper.style.top) || 0;

                    // Convert display coordinates to high-res canvas coordinates
                    const canvasX = (left / displayScale) * 2;
                    const canvasY = (top / displayScale) * 2;

                    // Draw plain text only - no background or border
                    ctx.fillStyle = '#e63946';
                    ctx.font = 'bold 26px sans-serif';
                    ctx.textBaseline = 'top';
                    ctx.textAlign = 'left';
                    ctx.fillText(value, canvasX + 6, canvasY + 4);
                }
            });

            // Draw page total at bottom
            const pageTotal = getPageTotal(i);
            if (pageTotal > 0) {
                const totalText = `ยอดหน้านี้: ${pageTotal.toLocaleString('th-TH')} บาท`;
                ctx.font = 'bold 28px sans-serif';
                const metrics = ctx.measureText(totalText);
                const padding = 16;
                const boxWidth = metrics.width + padding * 2;
                const boxHeight = 40;
                const boxX = viewport.width - boxWidth - 20;
                const boxY = viewport.height - boxHeight - 20;

                ctx.fillStyle = 'rgba(102, 126, 234, 0.9)';
                ctx.beginPath();
                ctx.roundRect(boxX, boxY, boxWidth, boxHeight, 8);
                ctx.fill();

                ctx.fillStyle = '#ffffff';
                ctx.textBaseline = 'middle';
                ctx.textAlign = 'center';
                ctx.fillText(totalText, boxX + boxWidth / 2, boxY + boxHeight / 2);
            }

            // Add canvas as image to PDF
            const pageVp = page.getViewport({ scale: 1 });
            const imgData = canvas.toDataURL('image/jpeg', 0.92);
            doc.addImage(imgData, 'JPEG', 0, 0, pageVp.width, pageVp.height);
        }

        // Add summary page
        doc.addPage([firstViewport.width, firstViewport.height], 'portrait');
        doc.setFillColor(26, 26, 46);
        doc.rect(0, 0, firstViewport.width, firstViewport.height, 'F');

        doc.setTextColor(255, 255, 255);
        doc.setFontSize(28);
        doc.text('สรุปยอดรวม', firstViewport.width / 2, 60, { align: 'center' });

        doc.setFontSize(18);
        let yPos = 120;
        let grandTotal = 0;

        for (let i = 1; i <= totalPages; i++) {
            const pageTotal = getPageTotal(i);
            grandTotal += pageTotal;
            doc.setTextColor(200, 200, 200);
            doc.text(`หน้า ${i}: ${pageTotal.toLocaleString('th-TH')} บาท`, firstViewport.width / 2, yPos, { align: 'center' });
            yPos += 35;
        }

        yPos += 20;
        doc.setDrawColor(102, 126, 234);
        doc.setLineWidth(2);
        doc.line(firstViewport.width * 0.2, yPos, firstViewport.width * 0.8, yPos);
        yPos += 40;

        doc.setTextColor(240, 147, 251);
        doc.setFontSize(24);
        doc.text(`ยอดรวมทั้งหมด: ${grandTotal.toLocaleString('th-TH')} บาท`, firstViewport.width / 2, yPos, { align: 'center' });

        // Save
        doc.save('pdf-sum-calculator-result.pdf');
    } catch (err) {
        console.error('Save PDF error:', err);
        alert('เกิดข้อผิดพลาดในการบันทึก PDF: ' + err.message);
    }

    btn.innerHTML = '<span class="file-icon">💾</span> บันทึก PDF';
    btn.disabled = false;
});

// Get page total helper
function getPageTotal(pageNum) {
    let total = 0;
    const container = document.querySelector(`.page-container[data-page="${pageNum}"]`);
    if (container) {
        container.querySelectorAll('.input-box').forEach(input => {
            total += parseFloat(input.value) || 0;
        });
    }
    return total;
}

// Setup page navigation
function setupPageNavigation() {
    const nav = document.getElementById('page-nav');
    nav.classList.remove('hidden');

    const select = document.getElementById('page-filter-select');
    select.innerHTML = '<option value="all">ทุกหน้า</option>';
    for (let i = 1; i <= totalPages; i++) {
        const opt = document.createElement('option');
        opt.value = i;
        opt.textContent = `หน้า ${i}`;
        select.appendChild(opt);
    }

    select.onchange = () => {
        currentViewPage = select.value;
        filterPages();
        updateNavInfo();
    };

    document.getElementById('nav-prev').onclick = () => navigatePage(-1);
    document.getElementById('nav-next').onclick = () => navigatePage(1);
    document.getElementById('nav-all').onclick = () => {
        currentViewPage = 'all';
        select.value = 'all';
        filterPages();
        updateNavInfo();
    };

    updateNavInfo();
}

function navigatePage(dir) {
    let current = currentViewPage === 'all' ? 1 : parseInt(currentViewPage);
    current += dir;
    if (current < 1) current = 1;
    if (current > totalPages) current = totalPages;
    currentViewPage = current.toString();
    document.getElementById('page-filter-select').value = current;
    filterPages();
    updateNavInfo();
}

function filterPages() {
    const containers = document.querySelectorAll('.page-container');
    containers.forEach(c => {
        if (currentViewPage === 'all') {
            c.classList.remove('hidden-page');
        } else {
            if (c.dataset.page === currentViewPage.toString()) {
                c.classList.remove('hidden-page');
            } else {
                c.classList.add('hidden-page');
            }
        }
    });

    // Update badge active state
    document.querySelectorAll('.page-sum-badge').forEach(b => {
        b.classList.remove('active');
        if (currentViewPage !== 'all' && b.dataset.page === currentViewPage.toString()) {
            b.classList.add('active');
        }
    });
}

function updateNavInfo() {
    const info = document.getElementById('nav-info');
    const prevBtn = document.getElementById('nav-prev');
    const nextBtn = document.getElementById('nav-next');

    if (currentViewPage === 'all') {
        info.textContent = `ทั้งหมด ${totalPages} หน้า`;
        prevBtn.disabled = true;
        nextBtn.disabled = true;
    } else {
        const p = parseInt(currentViewPage);
        info.textContent = `หน้า ${p} / ${totalPages}`;
        prevBtn.disabled = p <= 1;
        nextBtn.disabled = p >= totalPages;
    }
}

// Create input on click
function createInput(e, container) {
    if (e.target.closest('.input-wrapper')) return;

    const rect = container.getBoundingClientRect();
    const wrapper = document.createElement('div');
    wrapper.className = 'input-wrapper';
    wrapper.style.left = (e.clientX - rect.left - 40) + 'px';
    wrapper.style.top = (e.clientY - rect.top - 12) + 'px';

    const input = document.createElement('input');
    input.type = 'number';
    input.className = 'input-box';
    input.placeholder = '0';
    input.addEventListener('input', calculateSum);

    const del = document.createElement('div');
    del.className = 'delete-btn';
    del.innerHTML = '×';
    del.addEventListener('click', (ev) => {
        ev.stopPropagation();
        wrapper.remove();
        calculateSum();
    });

    wrapper.appendChild(input);
    wrapper.appendChild(del);
    container.appendChild(wrapper);

    // Make draggable
    makeDraggable(wrapper, input, container);

    // Focus the input
    input.focus();
}

// Draggable functionality
function makeDraggable(wrapper, input, container) {
    let isDragging = false;
    let startX, startY, initialLeft, initialTop;
    let hasMoved = false;

    // Drag handle - the entire wrapper area (grab from input directly)
    input.addEventListener('mousedown', (e) => {
        isDragging = true;
        hasMoved = false;
        wrapper.classList.add('dragging');
        startX = e.clientX;
        startY = e.clientY;
        initialLeft = parseInt(wrapper.style.left) || 0;
        initialTop = parseInt(wrapper.style.top) || 0;
        e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;

        const dx = e.clientX - startX;
        const dy = e.clientY - startY;

        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
            hasMoved = true;
        }

        let newLeft = initialLeft + dx;
        let newTop = initialTop + dy;

        // Constrain within container
        const containerWidth = container.offsetWidth;
        const containerHeight = container.offsetHeight;
        const wrapperWidth = wrapper.offsetWidth;
        const wrapperHeight = wrapper.offsetHeight;

        newLeft = Math.max(0, Math.min(newLeft, containerWidth - wrapperWidth));
        newTop = Math.max(0, Math.min(newTop, containerHeight - wrapperHeight));

        wrapper.style.left = newLeft + 'px';
        wrapper.style.top = newTop + 'px';
    });

    document.addEventListener('mouseup', () => {
        if (isDragging) {
            isDragging = false;
            wrapper.classList.remove('dragging');
            // If didn't move, focus input for typing
            if (!hasMoved) {
                input.focus();
            }
        }
    });

    // Double-click to focus for editing
    input.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        input.focus();
    });

    // Touch support
    input.addEventListener('touchstart', (e) => {
        isDragging = true;
        hasMoved = false;
        wrapper.classList.add('dragging');
        const touch = e.touches[0];
        startX = touch.clientX;
        startY = touch.clientY;
        initialLeft = parseInt(wrapper.style.left) || 0;
        initialTop = parseInt(wrapper.style.top) || 0;
    });

    document.addEventListener('touchmove', (e) => {
        if (!isDragging) return;

        const touch = e.touches[0];
        const dx = touch.clientX - startX;
        const dy = touch.clientY - startY;

        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
            hasMoved = true;
        }

        let newLeft = initialLeft + dx;
        let newTop = initialTop + dy;

        const containerWidth = container.offsetWidth;
        const containerHeight = container.offsetHeight;
        const wrapperWidth = wrapper.offsetWidth;
        const wrapperHeight = wrapper.offsetHeight;

        newLeft = Math.max(0, Math.min(newLeft, containerWidth - wrapperWidth));
        newTop = Math.max(0, Math.min(newTop, containerHeight - wrapperHeight));

        wrapper.style.left = newLeft + 'px';
        wrapper.style.top = newTop + 'px';

        e.preventDefault();
    }, { passive: false });

    document.addEventListener('touchend', () => {
        if (isDragging) {
            isDragging = false;
            wrapper.classList.remove('dragging');
            if (!hasMoved) {
                input.focus();
            }
        }
    });
}

// Calculate sum
function calculateSum() {
    let grandTotal = 0;
    const pageTotals = {};

    // Initialize page totals
    for (let i = 1; i <= totalPages; i++) {
        pageTotals[i] = 0;
    }

    // Sum all inputs per page
    document.querySelectorAll('.page-container').forEach(container => {
        const pageNum = parseInt(container.dataset.page);
        container.querySelectorAll('.input-box').forEach(input => {
            const val = parseFloat(input.value) || 0;
            pageTotals[pageNum] += val;
            grandTotal += val;
        });
    });

    // Update grand total
    document.getElementById('grand-total').textContent = grandTotal.toLocaleString('th-TH');

    // Update per-page labels on canvas
    for (let i = 1; i <= totalPages; i++) {
        const label = document.getElementById(`page-total-label-${i}`);
        if (label) {
            label.textContent = `ยอด: ${pageTotals[i].toLocaleString('th-TH')} บาท`;
        }
    }

    // Update summary badges
    updatePageSummaryBadges(pageTotals);
}

// Update page summary badges
function updatePageSummaryBadges(pageTotals) {
    const container = document.getElementById('page-summary-list');
    container.innerHTML = '';

    for (let i = 1; i <= totalPages; i++) {
        const badge = document.createElement('div');
        badge.className = 'page-sum-badge';
        badge.dataset.page = i;

        if (currentViewPage !== 'all' && currentViewPage.toString() === i.toString()) {
            badge.classList.add('active');
        }

        const pageLabel = document.createElement('div');
        pageLabel.className = 'badge-page';
        pageLabel.textContent = `หน้า ${i}`;

        const valueLabel = document.createElement('div');
        valueLabel.className = 'badge-value';
        const val = pageTotals ? (pageTotals[i] || 0) : 0;
        valueLabel.textContent = val.toLocaleString('th-TH');

        badge.appendChild(pageLabel);
        badge.appendChild(valueLabel);

        badge.addEventListener('click', () => {
            currentViewPage = i.toString();
            document.getElementById('page-filter-select').value = i;
            filterPages();
            updateNavInfo();
        });

        container.appendChild(badge);
    }
}

// ===== Save/Load Project (Backup) =====

// Save project as JSON
document.getElementById('saveProjectBtn').addEventListener('click', () => {
    const projectData = {
        version: 1,
        totalPages: totalPages,
        pages: []
    };

    document.querySelectorAll('.page-container').forEach(container => {
        const pageNum = parseInt(container.dataset.page);
        const inputs = [];

        container.querySelectorAll('.input-wrapper').forEach(wrapper => {
            const input = wrapper.querySelector('.input-box');
            inputs.push({
                left: wrapper.style.left,
                top: wrapper.style.top,
                value: input.value || ''
            });
        });

        projectData.pages.push({
            page: pageNum,
            inputs: inputs
        });
    });

    const blob = new Blob([JSON.stringify(projectData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'pdf-calculator-backup.json';
    a.click();
    URL.revokeObjectURL(url);
});

// Load project from JSON
document.getElementById('loadProjectInput').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
        try {
            const projectData = JSON.parse(reader.result);

            if (!projectData.pages || !Array.isArray(projectData.pages)) {
                alert('ไฟล์สำรองไม่ถูกต้อง');
                return;
            }

            // Check if PDF is loaded and pages match
            if (totalPages === 0) {
                alert('กรุณาอัพโหลดไฟล์ PDF ก่อน แล้วค่อยโหลดไฟล์สำรอง');
                return;
            }

            if (projectData.totalPages && projectData.totalPages !== totalPages) {
                if (!confirm(`ไฟล์สำรองมี ${projectData.totalPages} หน้า แต่ PDF ปัจจุบันมี ${totalPages} หน้า\nต้องการโหลดต่อหรือไม่?`)) {
                    return;
                }
            }

            // Clear existing inputs
            document.querySelectorAll('.input-wrapper').forEach(w => w.remove());

            // Restore inputs
            projectData.pages.forEach(pageData => {
                const container = document.querySelector(`.page-container[data-page="${pageData.page}"]`);
                if (!container) return;

                pageData.inputs.forEach(inputData => {
                    const wrapper = document.createElement('div');
                    wrapper.className = 'input-wrapper';
                    wrapper.style.left = inputData.left;
                    wrapper.style.top = inputData.top;

                    const input = document.createElement('input');
                    input.type = 'number';
                    input.className = 'input-box';
                    input.placeholder = '0';
                    input.value = inputData.value;
                    input.addEventListener('input', calculateSum);

                    const del = document.createElement('div');
                    del.className = 'delete-btn';
                    del.innerHTML = '×';
                    del.addEventListener('click', (ev) => {
                        ev.stopPropagation();
                        wrapper.remove();
                        calculateSum();
                    });

                    wrapper.appendChild(input);
                    wrapper.appendChild(del);
                    container.appendChild(wrapper);

                    makeDraggable(wrapper, input, container);
                });
            });

            // Recalculate
            calculateSum();
            alert('โหลดไฟล์สำรองเรียบร้อย!');

        } catch (err) {
            alert('เกิดข้อผิดพลาดในการอ่านไฟล์: ' + err.message);
        }
    };
    reader.readAsText(file);

    // Reset input so same file can be loaded again
    e.target.value = '';
});

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    console.log('PDF Sum Calculator Pro ready!');
});
