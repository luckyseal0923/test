import { apiJson, formatDateTime, toDateInput } from './utils.js';

const statEquipment = document.getElementById('statEquipment');
const statStock = document.getElementById('statStock');
const statBorrowed = document.getElementById('statBorrowed');
const statAvailable = document.getElementById('statAvailable');

const equipmentForm = document.getElementById('equipmentForm');
const equipmentHint = document.getElementById('equipmentHint');
const equipmentList = document.getElementById('equipmentList');

const borrowedList = document.getElementById('borrowedList');
const historyList = document.getElementById('historyList');

const eqName = document.getElementById('eqName');
const eqTotal = document.getElementById('eqTotal');
const eqCategory = document.getElementById('eqCategory');
const eqLocation = document.getElementById('eqLocation');
const eqNote = document.getElementById('eqNote');

const loanMask = document.getElementById('loanMask');
const loanEquipmentName = document.getElementById('loanEquipmentName');
const loanForm = document.getElementById('loanForm');
const loanBorrower = document.getElementById('loanBorrower');
const loanContact = document.getElementById('loanContact');
const loanPurpose = document.getElementById('loanPurpose');
const loanReturnDate = document.getElementById('loanReturnDate');
const loanCancel = document.getElementById('loanCancel');
const loanSubmit = document.getElementById('loanSubmit');
const loanHint = document.getElementById('loanHint');

let equipments = [];
let borrowedLoans = [];
let returnedLoans = [];
let selectedEquipment = null;

function renderSummary(stats) {
  statEquipment.textContent = String(stats?.equipmentTotal || 0);
  statStock.textContent = String(stats?.stockTotal || 0);
  statBorrowed.textContent = String(stats?.borrowedNow || 0);
  statAvailable.textContent = String(stats?.availableNow || 0);
}

function openLoanModal(equipment) {
  selectedEquipment = equipment;
  loanEquipmentName.textContent = equipment.name;
  loanBorrower.value = '';
  loanContact.value = '';
  loanPurpose.value = '';
  loanReturnDate.value = toDateInput(new Date(Date.now() + 3 * 24 * 60 * 60 * 1000));
  loanHint.textContent = '';
  loanMask.style.display = 'flex';
  setTimeout(() => loanBorrower.focus(), 20);
}

function closeLoanModal() {
  selectedEquipment = null;
  loanMask.style.display = 'none';
}

function renderEquipmentList() {
  equipmentList.innerHTML = '';
  if (!equipments.length) {
    const empty = document.createElement('div');
    empty.className = 'muted small';
    empty.textContent = '目前沒有器材，請先新增器材。';
    equipmentList.appendChild(empty);
    return;
  }

  for (const equipment of equipments) {
    const availableCount = Number(equipment.available_count || 0);
    const borrowedCount = Number(equipment.borrowed_count || 0);
    const row = document.createElement('div');
    row.className = 'linkline';
    row.innerHTML = `
      <div class="col" style="gap:4px;min-width:0">
        <div class="row" style="gap:6px">
          <b>${equipment.name}</b>
          ${equipment.category ? `<span class="pill">${equipment.category}</span>` : ''}
        </div>
        <div class="muted small">
          庫存 ${equipment.total_count}｜借出中 ${borrowedCount}｜可借 ${availableCount}
          ${equipment.location ? `｜位置：${equipment.location}` : ''}
        </div>
        ${equipment.note ? `<div class="small muted">${equipment.note}</div>` : ''}
      </div>
      <div class="row">
        <button class="btn primary" type="button" ${availableCount <= 0 ? 'disabled' : ''}>借用</button>
      </div>
    `;
    row.querySelector('button').addEventListener('click', () => openLoanModal(equipment));
    equipmentList.appendChild(row);
  }
}

function loanItem(loan, { allowReturn }) {
  const row = document.createElement('div');
  row.className = 'linkline';
  row.innerHTML = `
    <div class="col" style="gap:4px;min-width:0">
      <div class="row" style="gap:6px">
        <b>${loan.equipment_name}</b>
        ${loan.equipment_category ? `<span class="pill">${loan.equipment_category}</span>` : ''}
        ${
          loan.status === 'BORROWED'
            ? '<span class="pill"><b style="color:var(--warn)">借用中</b></span>'
            : '<span class="pill"><b style="color:var(--ok)">已歸還</b></span>'
        }
      </div>
      <div class="muted small">
        借用人：${loan.borrower_name}
        ${loan.borrower_contact ? `｜聯絡：${loan.borrower_contact}` : ''}
        ${loan.expected_return_date ? `｜預計歸還：${loan.expected_return_date}` : ''}
      </div>
      <div class="muted small">
        借出：${formatDateTime(loan.borrowed_at)}
        ${loan.returned_at ? `｜歸還：${formatDateTime(loan.returned_at)}` : ''}
      </div>
      ${loan.purpose ? `<div class="small muted">用途：${loan.purpose}</div>` : ''}
      ${loan.return_note ? `<div class="small muted">歸還備註：${loan.return_note}</div>` : ''}
    </div>
    <div class="row" data-actions></div>
  `;

  const actions = row.querySelector('[data-actions]');
  if (allowReturn && loan.status === 'BORROWED') {
    const btn = document.createElement('button');
    btn.className = 'btn ok';
    btn.type = 'button';
    btn.textContent = '辦理歸還';
    btn.addEventListener('click', async () => {
      const returnedCondition = window.prompt('歸還狀態（可留空）', '正常');
      if (returnedCondition === null) return;
      const returnNote = window.prompt('歸還備註（可留空）', '') ?? '';

      btn.disabled = true;
      try {
        await apiJson(`/api/loans/${loan.id}/return`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ returnedCondition, returnNote })
        });
        await refreshAll();
      } catch (error) {
        btn.disabled = false;
        window.alert(`歸還失敗：${error}`);
      }
    });
    actions.appendChild(btn);
  } else if (loan.returned_condition) {
    const cond = document.createElement('span');
    cond.className = 'pill';
    cond.textContent = `狀態：${loan.returned_condition}`;
    actions.appendChild(cond);
  }
  return row;
}

function renderLoans() {
  borrowedList.innerHTML = '';
  historyList.innerHTML = '';

  if (!borrowedLoans.length) {
    const empty = document.createElement('div');
    empty.className = 'muted small';
    empty.textContent = '目前沒有借用中的器材。';
    borrowedList.appendChild(empty);
  } else {
    for (const loan of borrowedLoans) {
      borrowedList.appendChild(loanItem(loan, { allowReturn: true }));
    }
  }

  if (!returnedLoans.length) {
    const empty = document.createElement('div');
    empty.className = 'muted small';
    empty.textContent = '尚無歸還紀錄。';
    historyList.appendChild(empty);
  } else {
    for (const loan of returnedLoans) {
      historyList.appendChild(loanItem(loan, { allowReturn: false }));
    }
  }
}

async function refreshAll() {
  const [summaryJson, equipmentsJson, borrowedJson, returnedJson] = await Promise.all([
    apiJson('/api/summary'),
    apiJson('/api/equipments'),
    apiJson('/api/loans?status=BORROWED&limit=200'),
    apiJson('/api/loans?status=RETURNED&limit=100')
  ]);

  renderSummary(summaryJson.stats || {});
  equipments = equipmentsJson.equipments || [];
  borrowedLoans = borrowedJson.loans || [];
  returnedLoans = returnedJson.loans || [];
  renderEquipmentList();
  renderLoans();
}

equipmentForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  const payload = {
    name: eqName.value.trim(),
    totalCount: Number(eqTotal.value || 0),
    category: eqCategory.value.trim(),
    location: eqLocation.value.trim(),
    note: eqNote.value.trim()
  };
  equipmentHint.textContent = '新增中...';

  try {
    await apiJson('/api/equipments', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    });
    equipmentForm.reset();
    eqTotal.value = '1';
    equipmentHint.textContent = '新增完成。';
    await refreshAll();
  } catch (error) {
    equipmentHint.textContent = `新增失敗：${error}`;
  }
});

loanCancel.addEventListener('click', closeLoanModal);
loanMask.addEventListener('click', (event) => {
  if (event.target === loanMask) closeLoanModal();
});

loanForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!selectedEquipment) return;

  const payload = {
    equipmentId: selectedEquipment.id,
    borrowerName: loanBorrower.value.trim(),
    borrowerContact: loanContact.value.trim(),
    purpose: loanPurpose.value.trim(),
    expectedReturnDate: loanReturnDate.value.trim()
  };

  loanSubmit.disabled = true;
  loanHint.textContent = '借用登記中...';

  try {
    await apiJson('/api/loans', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    });
    closeLoanModal();
    await refreshAll();
  } catch (error) {
    loanHint.textContent = `借用失敗：${error}`;
  } finally {
    loanSubmit.disabled = false;
  }
});

refreshAll().catch((error) => {
  equipmentHint.textContent = `載入失敗：${error}`;
});

