// ========================================
// 設定
// ========================================
const API_BASE_URL = 'https://gpts-email-system-v7-fbqowedyyq-an.a.run.app';

// リトライ設定
const MAX_API_RETRIES = 2;
const API_RETRY_DELAY = 1000;

// 認証トークン
let authToken = localStorage.getItem('authToken') || null;

// グローバル変数
let currentFilter = 'all';
let currentPlanId = null;
let currentHistoryTypeFilter = 'all';

// ========================================
// ユーティリティ関数
// ========================================

// API呼び出しヘルパー（リトライ機能付き）
async function apiCall(endpoint, method = 'GET', data = null, requireAuth = true, retries = MAX_API_RETRIES) {
    const headers = {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
    };
    
    if (requireAuth && authToken) {
        headers['Authorization'] = `Bearer ${authToken}`;
    }
    
    const options = {
        method: method,
        headers: headers,
        mode: 'cors',
        credentials: 'omit'
    };
    
    if (data && (method === 'POST' || method === 'PUT')) {
        options.body = JSON.stringify(data);
    }
    
    let lastError = null;
    
    for (let attempt = 0; attempt < retries; attempt++) {
        try {
            console.log(`API Call [${attempt + 1}/${retries}]: ${method} ${endpoint}`);
            
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 30000);
            
            options.signal = controller.signal;
            
            const response = await fetch(`${API_BASE_URL}${endpoint}`, options);
            
            clearTimeout(timeoutId);
            
            if (response.status === 401) {
                logout();
                throw new Error('認証エラー。再度ログインしてください。');
            }
            
            if (!response.ok) {
                let errorData;
                try {
                    errorData = await response.json();
                } catch {
                    errorData = { error: `HTTP ${response.status}: ${response.statusText}` };
                }
                throw new Error(errorData.error || `HTTP ${response.status}`);
            }
            
            const result = await response.json();
            console.log(`✅ API Success: ${endpoint}`);
            return result;
            
        } catch (error) {
            lastError = error;
            console.error(`❌ API Error [${attempt + 1}/${retries}]: ${endpoint}`, error);
            
            if (error.name === 'AbortError') {
                lastError = new Error('リクエストがタイムアウトしました');
            }
            
            if (attempt < retries - 1) {
                const delay = API_RETRY_DELAY * (attempt + 1);
                console.log(`⏳ リトライ ${attempt + 1}/${retries}: ${endpoint} (${delay}ms後)`);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }
    
    console.error('❌ 全リトライ失敗:', lastError);
    throw lastError || new Error('接続エラーが発生しました');
}

// 接続テスト関数
async function testConnection() {
    try {
        const response = await fetch(`${API_BASE_URL}/health`, {
            method: 'GET',
            mode: 'cors',
            credentials: 'omit'
        });
        
        if (response.ok) {
            const data = await response.json();
            console.log('✅ サーバー接続成功:', data);
            return true;
        } else {
            console.error('❌ サーバー接続失敗:', response.status);
            return false;
        }
    } catch (error) {
        console.error('❌ サーバー接続エラー:', error);
        return false;
    }
}

// フィールド表示切替
function toggleEmailFields() {
    const enabled = document.getElementById('emailEnabled').checked;
    document.getElementById('emailFields').classList.toggle('hidden', !enabled);
}

function toggleEmailCustomFields() {
    const frequency = document.getElementById('emailFrequency').value;
    document.getElementById('emailCustomFields').classList.toggle('hidden', frequency !== 'custom');
}

function toggleNoteFields() {
    const enabled = document.getElementById('noteEnabled').checked;
    document.getElementById('noteFields').classList.toggle('hidden', !enabled);
}

function toggleNoteCustomFields() {
    const frequency = document.getElementById('noteFrequency').value;
    document.getElementById('noteCustomFields').classList.toggle('hidden', frequency !== 'custom');
}

// ステータステキスト取得
function getStatusText(status) {
    const statusMap = {
        'pending': '承認待ち',
        'approved': '承認済み',
        'rejected': '却下',
        'cancelled': '解約済み'
    };
    return statusMap[status] || status;
}

// ログアウト処理
function logout() {
    authToken = null;
    localStorage.removeItem('authToken');
    document.getElementById('loginScreen').style.display = 'flex';
    document.getElementById('mainScreen').classList.remove('active');
    document.getElementById('loginForm').reset();
}

// ========================================
// 認証
// ========================================

// ログイン
async function handleLogin(event) {
    event.preventDefault();
    
    const userId = document.getElementById('loginId').value;
    const password = document.getElementById('loginPassword').value;
    const errorDiv = document.getElementById('loginError');
    
    errorDiv.classList.add('hidden');
    errorDiv.textContent = '';
    
    try {
        const response = await apiCall('/api/auth/login', 'POST', {
            userId: userId,
            password: password
        }, false);
        
        authToken = response.token;
        localStorage.setItem('authToken', authToken);
        
        document.getElementById('loginScreen').style.display = 'none';
        document.getElementById('mainScreen').classList.add('active');
        loadApplications();
    } catch (error) {
        errorDiv.textContent = error.message;
        errorDiv.classList.remove('hidden');
    }
}

// パスワード変更
async function handlePasswordChange(event) {
    event.preventDefault();
    
    const userId = document.getElementById('changePasswordUserId').value;
    const currentPassword = document.getElementById('currentPassword').value;
    const newPassword = document.getElementById('newPassword').value;
    const messageDiv = document.getElementById('passwordChangeMessage');
    
    messageDiv.classList.add('hidden');
    messageDiv.textContent = '';
    
    try {
        await apiCall('/api/auth/change-password', 'POST', {
            userId: userId,
            currentPassword: currentPassword,
            newPassword: newPassword
        });
        
        messageDiv.textContent = 'パスワードを変更しました';
        messageDiv.className = 'success-message';
        document.getElementById('passwordChangeForm').reset();
    } catch (error) {
        messageDiv.textContent = error.message;
        messageDiv.className = 'error-message';
    }
}

// ========================================
// 申請者管理
// ========================================

// 申請者一覧読み込み
async function loadApplications(filterStatus = 'all') {
    currentFilter = filterStatus;
    const tbody = document.querySelector('#applicationsTable tbody');
    tbody.innerHTML = '<tr><td colspan="6" style="text-align: center;">読み込み中...</td></tr>';
    
    try {
        const queryParam = filterStatus !== 'all' ? `?status=${filterStatus}` : '';
        const applications = await apiCall(`/api/applications${queryParam}`);
        
        tbody.innerHTML = '';
        
        if (applications.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" style="text-align: center;">申請者がいません</td></tr>';
            return;
        }
        
        applications.forEach(app => {
            const tr = document.createElement('tr');
            tr.style.cursor = 'pointer';
            
            let actionButtons = '';
            if (app.status === 'pending') {
                actionButtons = `
                    <button class="action-btn" onclick="updateApplicationStatus('${app.id}', 'approved')">承認</button>
                    <button class="action-btn" onclick="updateApplicationStatus('${app.id}', 'rejected')">却下</button>
                `;
            } else if (app.status === 'rejected') {
                actionButtons = `
                    <button class="action-btn" onclick="updateApplicationStatus('${app.id}', 'approved')">承認</button>
                `;
            } else if (app.status === 'approved') {
                actionButtons = `
                    <button class="action-btn btn-danger" onclick="cancelSubscription('${app.id}')">解約</button>
                `;
            }
            
            const fullName = `${app.lastName || ''} ${app.firstName || ''}`;
            
            tr.innerHTML = `
                <td>${app.memberNumber}</td>
                <td>${fullName}</td>
                <td><span class="badge badge-${app.status}">${getStatusText(app.status)}</span></td>
                <td>${app.plan}</td>
                <td>${app.appliedDate}</td>
                <td class="action-btns" onclick="event.stopPropagation()">
                    ${actionButtons}
                </td>
            `;
            tr.onclick = function() { showApplicationDetail(app.id); };
            tbody.appendChild(tr);
        });
    } catch (error) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: #dc3545;">${error.message}</td></tr>`;
    }
}

// 申請者詳細表示
async function showApplicationDetail(id) {
    try {
        const app = await apiCall(`/api/applications/${id}`);
        
        const detailBody = document.getElementById('applicationDetailBody');
        const fullName = `${app.lastName || ''} ${app.firstName || ''}`;
        
        detailBody.innerHTML = `
            <div class="info-row">
                <div class="info-label">会員番号:</div>
                <div class="info-value">${app.memberNumber}</div>
            </div>
            <div class="info-row">
                <div class="info-label">氏名:</div>
                <div class="info-value">${fullName}</div>
            </div>
            <div class="info-row">
                <div class="info-label">姓:</div>
                <div class="info-value">${app.lastName || ''}</div>
            </div>
            <div class="info-row">
                <div class="info-label">名:</div>
                <div class="info-value">${app.firstName || ''}</div>
            </div>
            <div class="info-row">
                <div class="info-label">生年月日:</div>
                <div class="info-value">${app.birthDate}</div>
            </div>
            <div class="info-row">
                <div class="info-label">メールアドレス:</div>
                <div class="info-value">${app.email}</div>
            </div>
            <div class="info-row">
                <div class="info-label">プラン:</div>
                <div class="info-value">${app.plan}</div>
            </div>
            <div class="info-row">
                <div class="info-label">ステータス:</div>
                <div class="info-value"><span class="badge badge-${app.status}">${getStatusText(app.status)}</span></div>
            </div>
            <div class="info-row">
                <div class="info-label">申請日:</div>
                <div class="info-value">${app.appliedDate}</div>
            </div>
            ${app.lastSendDate ? `
            <div class="info-row">
                <div class="info-label">最終送信日:</div>
                <div class="info-value">${app.lastSendDate}</div>
            </div>
            ` : ''}
        `;
        document.getElementById('applicationDetailModal').classList.add('active');
    } catch (error) {
        alert(error.message);
    }
}

// 申請ステータス更新
async function updateApplicationStatus(id, newStatus) {
    try {
        await apiCall(`/api/applications/${id}/status`, 'PUT', {
            status: newStatus
        });
        
        loadApplications(currentFilter);
        alert(`申請を${getStatusText(newStatus)}しました`);
    } catch (error) {
        alert(error.message);
    }
}

// 解約処理
async function cancelSubscription(id) {
    const lastSendDate = prompt('最終送信日を入力してください（YYYY-MM-DD形式）:');
    
    if (!lastSendDate) {
        return;
    }
    
    const datePattern = /^\d{4}-\d{2}-\d{2}$/;
    if (!datePattern.test(lastSendDate)) {
        alert('日付の形式が正しくありません。YYYY-MM-DD形式で入力してください。');
        return;
    }
    
    try {
        await apiCall(`/api/applications/${id}/status`, 'PUT', {
            status: 'cancelled',
            lastSendDate: lastSendDate
        });
        
        if (document.getElementById('planDetailModal').classList.contains('active')) {
            loadPlanCustomers(currentPlanId);
        }
        
        loadApplications(currentFilter);
        alert(`解約処理が完了しました。最終送信日: ${lastSendDate}`);
    } catch (error) {
        alert(error.message);
    }
}

// ========================================
// プラン管理
// ========================================

// プラン一覧読み込み
async function loadPlans() {
    const planGrid = document.getElementById('planGrid');
    planGrid.innerHTML = '<p style="padding: 20px;">読み込み中...</p>';
    
    try {
        const plans = await apiCall('/api/plans');
        
        planGrid.innerHTML = '';
        
        if (plans.length === 0) {
            planGrid.innerHTML = '<p style="padding: 20px;">プランがありません</p>';
            return;
        }
        
        plans.forEach(plan => {
            const planCard = document.createElement('div');
            planCard.className = 'plan-card';
            planCard.style.cursor = 'pointer';
            
            let emailInfo = '無効';
            if (plan.emailEnabled) {
                emailInfo = plan.emailFrequency === 'custom' 
                    ? `有効（カスタム日付, ${plan.emailSendTime}）`
                    : `有効（毎日 ${plan.emailSendTime}）`;
            }
            
            let noteInfo = '無効';
            if (plan.noteEnabled) {
                noteInfo = plan.noteFrequency === 'custom'
                    ? `有効（カスタム日付, ${plan.notePostTime}）`
                    : `有効（毎日 ${plan.notePostTime}）`;
            }
            
            let details = `
                <p><strong>モデル:</strong> ${plan.model || 'gpt-4o'}</p>
                <p><strong>外部データ:</strong> ${plan.externalDataPath || 'なし'}</p>
                <p><strong>メール送信:</strong> ${emailInfo}</p>
                <p><strong>NOTE投稿:</strong> ${noteInfo}</p>
                ${plan.noteEmail ? '<p><strong>NOTE専用アカウント:</strong> 設定済み</p>' : ''}
            `;
            
            planCard.innerHTML = `
                <h3>${plan.name}</h3>
                <div class="plan-details">
                    ${details}
                </div>
                <div class="plan-actions">
                    <button class="btn" onclick="event.stopPropagation(); showPlanDetail('${plan.id}')" style="background: #007bff;">詳細</button>
                    <button class="btn btn-danger" onclick="event.stopPropagation(); deletePlan('${plan.id}')">削除</button>
                </div>
            `;
            planCard.onclick = function() { showPlanDetail(plan.id); };
            planGrid.appendChild(planCard);
        });
    } catch (error) {
        planGrid.innerHTML = `<p style="padding: 20px; color: #dc3545;">${error.message}</p>`;
    }
}

// プラン詳細表示
async function showPlanDetail(planId) {
    try {
        const plan = await apiCall(`/api/plans/${planId}`);
        
        currentPlanId = planId;
        
        document.getElementById('planDetailTitle').textContent = `${plan.name} - 詳細`;
        
        const planDetailInfo = document.getElementById('planDetailInfo');
        
        let emailInfo = '無効';
        if (plan.emailEnabled) {
            emailInfo = plan.emailFrequency === 'custom'
                ? `有効（カスタム日付: ${plan.emailCustomSpreadsheetId || '未設定'}, ${plan.emailSendTime}）`
                : `有効（毎日 ${plan.emailSendTime}）`;
        }
        
        let noteInfo = '無効';
        if (plan.noteEnabled) {
            noteInfo = plan.noteFrequency === 'custom'
                ? `有効（カスタム日付: ${plan.noteCustomSpreadsheetId || '未設定'}, ${plan.notePostTime}）`
                : `有効（毎日 ${plan.notePostTime}）`;
        }
        
        let detailsHTML = `
            <div class="info-row">
                <div class="info-label">プラン名:</div>
                <div class="info-value">${plan.name}</div>
            </div>
            <div class="info-row">
                <div class="info-label">使用モデル:</div>
                <div class="info-value">${plan.model || 'gpt-4o'}</div>
            </div>
            <div class="info-row">
                <div class="info-label">外部データ:</div>
                <div class="info-value">${plan.externalDataPath || 'なし'}</div>
            </div>
            <div class="info-row">
                <div class="info-label">メール自動送信:</div>
                <div class="info-value">${emailInfo}</div>
            </div>
            <div class="info-row">
                <div class="info-label">NOTE自動投稿:</div>
                <div class="info-value">${noteInfo}</div>
            </div>
            ${plan.noteEmail ? `
            <div class="info-row">
                <div class="info-label">NOTE専用アカウント:</div>
                <div class="info-value">${plan.noteEmail}</div>
            </div>
            ` : ''}
            <div class="info-row">
                <div class="info-label">ベースプロンプト:</div>
                <div class="info-value" style="white-space: pre-wrap;">${plan.basePrompt || ''}</div>
            </div>
            <div class="info-row">
                <div class="info-label">個別指示:</div>
                <div class="info-value" style="white-space: pre-wrap;">${plan.individualInstruction || ''}</div>
            </div>
            ${plan.promptCacheId ? `
            <div class="info-row">
                <div class="info-label">キャッシュID:</div>
                <div class="info-value">${plan.promptCacheId}</div>
            </div>
            ` : ''}
        `;
        
        planDetailInfo.innerHTML = detailsHTML;
        
        loadPlanCustomers(planId);
        
        document.getElementById('planDetailModal').classList.add('active');
    } catch (error) {
        alert(error.message);
    }
}

// プラン加入者一覧読み込み
async function loadPlanCustomers(planId, searchQuery = '') {
    const tbody = document.querySelector('#planCustomersTable tbody');
    tbody.innerHTML = '<tr><td colspan="5" style="text-align: center;">読み込み中...</td></tr>';
    
    try {
        const queryParam = searchQuery ? `?search=${encodeURIComponent(searchQuery)}` : '';
        const subscribers = await apiCall(`/api/plans/${planId}/subscribers${queryParam}`);
        
        tbody.innerHTML = '';
        
        if (subscribers.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" style="text-align: center;">該当する加入者がいません</td></tr>';
            return;
        }
        
        subscribers.forEach(customer => {
            const tr = document.createElement('tr');
            const fullName = `${customer.lastName || ''} ${customer.firstName || ''}`;
            
            tr.innerHTML = `
                <td>${customer.memberNumber}</td>
                <td>${fullName}</td>
                <td>${customer.email}</td>
                <td>${customer.appliedDate}</td>
                <td>
                    <button class="action-btn btn-danger" onclick="cancelSubscription('${customer.id}')">解約</button>
                </td>
            `;
            tbody.appendChild(tr);
        });
    } catch (error) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: #dc3545;">${error.message}</td></tr>`;
    }
}

// プラン追加モーダル表示
function showAddPlanModal() {
    console.log('🆕 プラン追加モーダルを開きます');
    document.getElementById('planModalTitle').textContent = 'プラン追加';
    document.getElementById('planForm').reset();
    document.getElementById('planId').value = '';
    document.getElementById('planModel').value = 'gpt-4o';
    document.getElementById('planBasePrompt').value = '';
    document.getElementById('planIndividualInstruction').value = '';
    
    // 頻度フィールドの初期化
    document.getElementById('emailFrequency').value = 'daily';
    document.getElementById('noteFrequency').value = 'daily';
    
    toggleEmailFields();
    toggleNoteFields();
    toggleEmailCustomFields();
    toggleNoteCustomFields();
    
    document.getElementById('planModal').classList.add('active');
    console.log('✅ プラン追加モーダルを開きました');
}

// プラン編集
async function editPlan(id) {
    try {
        const plan = await apiCall(`/api/plans/${id}`);
        
        document.getElementById('planModalTitle').textContent = 'プラン編集';
        document.getElementById('planId').value = plan.id;
        document.getElementById('planName').value = plan.name;
        document.getElementById('planBasePrompt').value = plan.basePrompt || '';
        document.getElementById('planIndividualInstruction').value = plan.individualInstruction || '';
        document.getElementById('planModel').value = plan.model || 'gpt-4o';
        document.getElementById('externalDataPath').value = plan.externalDataPath || '';

        
        // メール設定
        document.getElementById('emailEnabled').checked = plan.emailEnabled || false;
        document.getElementById('emailFrequency').value = plan.emailFrequency || 'daily';
        document.getElementById('emailSendTime').value = plan.emailSendTime || '09:00';
        document.getElementById('emailCustomSpreadsheetId').value = plan.emailCustomSpreadsheetId || '';
        
        // NOTE設定
        document.getElementById('noteEnabled').checked = plan.noteEnabled || false;
        document.getElementById('planNoteEmail').value = plan.noteEmail || '';
        document.getElementById('planNotePassword').value = plan.notePassword || '';
        document.getElementById('noteFrequency').value = plan.noteFrequency || 'daily';
        document.getElementById('notePostTime').value = plan.notePostTime || '09:00';
        document.getElementById('noteCustomSpreadsheetId').value = plan.noteCustomSpreadsheetId || '';
        document.getElementById('thumbnailMapping').value = plan.thumbnailMapping || '';
        
        toggleEmailFields();
        toggleEmailCustomFields();
        toggleNoteFields();
        toggleNoteCustomFields();
        
        document.getElementById('planModal').classList.add('active');
    } catch (error) {
        alert(error.message);
    }
}

// プラン詳細から編集
function editPlanFromDetail() {
    if (currentPlanId) {
        document.getElementById('planDetailModal').classList.remove('active');
        editPlan(currentPlanId);
    }
}

// プラン保存
// プラン保存
async function savePlan() {
    console.log('🔵 savePlan関数が呼ばれました');
    
    const id = document.getElementById('planId').value;
    const name = document.getElementById('planName').value;
    const basePrompt = document.getElementById('planBasePrompt').value;
    const individualInstruction = document.getElementById('planIndividualInstruction').value;
    const model = document.getElementById('planModel').value;
    const externalDataPath = document.getElementById('externalDataPath').value;
    
    console.log('📝 基本情報取得:', { id, name, model });
    
    const emailEnabled = document.getElementById('emailEnabled').checked;
    const emailFrequency = document.getElementById('emailFrequency').value;
    const emailSendTime = document.getElementById('emailSendTime').value;
    const emailCustomSpreadsheetId = document.getElementById('emailCustomSpreadsheetId').value;
    
    const noteEnabled = document.getElementById('noteEnabled').checked;
    const noteFrequency = document.getElementById('noteFrequency').value;
    const notePostTime = document.getElementById('notePostTime').value;
    const noteCustomSpreadsheetId = document.getElementById('noteCustomSpreadsheetId').value;
    const thumbnailMapping = document.getElementById('thumbnailMapping').value;
    const planNoteEmail = document.getElementById('planNoteEmail').value;
    const planNotePassword = document.getElementById('planNotePassword').value;

    console.log('📧 メール設定:', { emailEnabled, emailFrequency });
    console.log('📝 NOTE設定:', { noteEnabled, noteFrequency });

    if (!name) {
        alert('プラン名を入力してください');
        return;
    }

    const data = {
        name: name,
        basePrompt: basePrompt,
        individualInstruction: individualInstruction,
        model: model,
        externalDataPath: externalDataPath,
        emailEnabled: emailEnabled,
        noteEnabled: noteEnabled
    };
    
    if (emailEnabled) {
        data.emailFrequency = emailFrequency;
        data.emailSendTime = emailSendTime;
        if (emailFrequency === 'custom') {
            data.emailCustomSpreadsheetId = emailCustomSpreadsheetId;
        }
    }
    
    if (noteEnabled) {
        data.noteFrequency = noteFrequency;
        data.notePostTime = notePostTime;
        data.thumbnailMapping = thumbnailMapping;
        data.noteEmail = planNoteEmail;
        data.notePassword = planNotePassword;
        if (noteFrequency === 'custom') {
            data.noteCustomSpreadsheetId = noteCustomSpreadsheetId;
        }
    }

    console.log('📦 送信データ:', data);

    try {
        console.log('🚀 API呼び出し開始');
        if (id) {
            await apiCall(`/api/plans/${id}`, 'PUT', data);
        } else {
            await apiCall('/api/plans', 'POST', data);
        }
        
        console.log('✅ API呼び出し成功');
        document.getElementById('planModal').classList.remove('active');
        loadPlans();
        alert('プランを保存しました');
    } catch (error) {
        console.error('❌ API呼び出しエラー:', error);
        alert(error.message);
    }
}

// プラン削除
async function deletePlan(id) {
    if (!confirm('このプランを削除してもよろしいですか?')) {
        return;
    }
    
    try {
        await apiCall(`/api/plans/${id}`, 'DELETE');
        loadPlans();
        alert('プランを削除しました');
    } catch (error) {
        alert(error.message);
    }
}

// ========================================
// 送信履歴
// ========================================

// 送信履歴読み込み
async function loadHistory(filterDate = null, typeFilter = 'all') {
    currentHistoryTypeFilter = typeFilter;
    const tbody = document.querySelector('#historyTable tbody');
    tbody.innerHTML = '<tr><td colspan="6" style="text-align: center;">読み込み中...</td></tr>';
    
    try {
        const queryParam = filterDate ? `?date=${filterDate}` : '';
        const history = await apiCall(`/api/history${queryParam}`);
        
        tbody.innerHTML = '';
        
        // タイプでフィルター
        let filteredHistory = history;
        if (typeFilter !== 'all') {
            filteredHistory = history.filter(item => item.type === typeFilter);
        }
        
        if (filteredHistory.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" style="text-align: center;">履歴がありません</td></tr>';
            return;
        }
        
        filteredHistory.forEach(item => {
            const tr = document.createElement('tr');
            
            // タイプ表示
            let typeText = '不明';
            if (item.type === 'scheduled-email') {
                typeText = '定時メール';
            } else if (item.type === 'manual') {
                typeText = '手動メール';
            } else if (item.type === 'scheduled-note') {
                typeText = 'NOTE投稿';
            }
            
            tr.innerHTML = `
                <td>${item.date}</td>
                <td>${item.plan}</td>
                <td>${typeText}</td>
                <td>${item.count}件</td>
                <td>${item.status}</td>
                <td>
                    <button class="action-btn btn-danger" onclick="deleteHistory('${item.id}')">削除</button>
                </td>
            `;
            tbody.appendChild(tr);
        });
    } catch (error) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: #dc3545;">${error.message}</td></tr>`;
    }
}

// 履歴削除
async function deleteHistory(id) {
    if (!confirm('この履歴を削除してもよろしいですか?')) {
        return;
    }
    
    try {
        await apiCall(`/api/history/${id}`, 'DELETE');
        const dateFilter = document.getElementById('historyDateFilter').value;
        loadHistory(dateFilter, currentHistoryTypeFilter);
        alert('履歴を削除しました');
    } catch (error) {
        alert(error.message);
    }
}

// ========================================
// 手動メール送信
// ========================================

// 手動メール送信画面読み込み
async function loadManualSend() {
    const select = document.getElementById('manualSendPlan');
    select.innerHTML = '<option value="">読み込み中...</option>';
    
    try {
        const plans = await apiCall('/api/plans');
        
        select.innerHTML = '';
        
        if (plans.length === 0) {
            select.innerHTML = '<option value="">プランがありません</option>';
            return;
        }
        
        plans.forEach(plan => {
            const option = document.createElement('option');
            option.value = plan.id;
            option.textContent = plan.name;
            select.appendChild(option);
        });
    } catch (error) {
        select.innerHTML = `<option value="">エラー: ${error.message}</option>`;
    }
}

// 手動メール送信
async function handleManualSend(event) {
    event.preventDefault();
    
    const planId = document.getElementById('manualSendPlan').value;
    const subject = document.getElementById('manualSendSubject').value;
    const body = document.getElementById('manualSendBody').value;
    
    if (!confirm('選択したプランの全加入者にメールを送信しますか?')) {
        return;
    }
    
    try {
        const result = await apiCall('/api/send-manual', 'POST', {
            planId, subject, body
        });
        
        alert(result.message);
        document.getElementById('manualSendForm').reset();
    } catch (error) {
        alert(error.message);
    }
}

// ========================================
// 設定
// ========================================

// Scheduler同期
async function syncSchedulerJobs() {
    const messageDiv = document.getElementById('schedulerSyncMessage');
    const btn = document.getElementById('syncSchedulerBtn');
    
    messageDiv.classList.add('hidden');
    messageDiv.textContent = '';
    btn.disabled = true;
    btn.textContent = '同期中...';
    
    try {
        const result = await apiCall('/api/scheduler/sync', 'POST');
        
        messageDiv.textContent = result.message;
        messageDiv.className = 'success-message';
        btn.textContent = 'Schedulerジョブを同期';
    } catch (error) {
        messageDiv.textContent = error.message;
        messageDiv.className = 'error-message';
        btn.textContent = 'Schedulerジョブを同期';
    } finally {
        btn.disabled = false;
    }
}

// 設定読み込み
async function loadSettings() {
    try {
        const settings = await apiCall('/api/settings');
        
        document.getElementById('openaiApiKey').value = settings.openaiApiKey || '';
        document.getElementById('noteEmail').value = settings.noteEmail || '';
        document.getElementById('notePassword').value = settings.notePassword || '';
        
        await loadStaff();
    } catch (error) {
        console.error('設定読み込みエラー:', error);
    }
}

// OpenAI API Key保存
async function handleOpenAIApiSave(event) {
    event.preventDefault();
    
    const openaiApiKey = document.getElementById('openaiApiKey').value;
    const messageDiv = document.getElementById('openaiApiMessage');
    
    messageDiv.classList.add('hidden');
    messageDiv.textContent = '';
    
    try {
        await apiCall('/api/settings', 'PUT', {
            openaiApiKey: openaiApiKey
        });
        
        messageDiv.textContent = 'OpenAI API Keyを保存しました';
        messageDiv.className = 'success-message';
    } catch (error) {
        messageDiv.textContent = error.message;
        messageDiv.className = 'error-message';
    }
}

// NOTE認証設定保存
async function handleNoteAuthSave(event) {
    event.preventDefault();
    
    const noteEmail = document.getElementById('noteEmail').value;
    const notePassword = document.getElementById('notePassword').value;
    const messageDiv = document.getElementById('noteAuthMessage');
    
    messageDiv.classList.add('hidden');
    messageDiv.textContent = '';
    
    try {
        await apiCall('/api/settings', 'PUT', {
            noteEmail: noteEmail,
            notePassword: notePassword
        });
        
        messageDiv.textContent = 'NOTE認証情報を保存しました';
        messageDiv.className = 'success-message';
    } catch (error) {
        messageDiv.textContent = error.message;
        messageDiv.className = 'error-message';
    }
}

// スタッフ一覧読み込み
async function loadStaff() {
    const tbody = document.querySelector('#staffTable tbody');
    tbody.innerHTML = '<tr><td colspan="3" style="text-align: center;">読み込み中...</td></tr>';
    
    try {
        const staff = await apiCall('/api/staff');
        
        tbody.innerHTML = '';
        
        if (staff.length === 0) {
            tbody.innerHTML = '<tr><td colspan="3" style="text-align: center;">スタッフが登録されていません</td></tr>';
            return;
        }
        
        staff.forEach(s => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${s.name}</td>
                <td>${s.email}</td>
                <td class="action-btns">
                    <button class="action-btn" onclick="editStaff('${s.id}')">編集</button>
                    <button class="action-btn btn-danger" onclick="deleteStaff('${s.id}')">削除</button>
                </td>
            `;
            tbody.appendChild(tr);
        });
    } catch (error) {
        tbody.innerHTML = `<tr><td colspan="3" style="text-align: center; color: #dc3545;">${error.message}</td></tr>`;
    }
}

// スタッフ追加モーダル表示
function showAddStaffModal() {
    document.getElementById('staffModalTitle').textContent = 'スタッフ追加';
    document.getElementById('staffForm').reset();
    document.getElementById('staffId').value = '';
    document.getElementById('staffModal').classList.add('active');
}

// スタッフ編集
async function editStaff(id) {
    try {
        const staff = await apiCall('/api/staff');
        const member = staff.find(s => s.id === id);
        
        if (member) {
            document.getElementById('staffModalTitle').textContent = 'スタッフ編集';
            document.getElementById('staffId').value = member.id;
            document.getElementById('staffName').value = member.name;
            document.getElementById('staffEmail').value = member.email;
            document.getElementById('staffModal').classList.add('active');
        }
    } catch (error) {
        alert(error.message);
    }
}

// スタッフ保存
async function saveStaff() {
    const id = document.getElementById('staffId').value;
    const name = document.getElementById('staffName').value;
    const email = document.getElementById('staffEmail').value;

    if (!name || !email) {
        alert('全ての項目を入力してください');
        return;
    }

    try {
        if (id) {
            await apiCall(`/api/staff/${id}`, 'PUT', { name, email });
        } else {
            await apiCall('/api/staff', 'POST', { name, email });
        }
        
        document.getElementById('staffModal').classList.remove('active');
        loadStaff();
        alert('スタッフ情報を保存しました');
    } catch (error) {
        alert(error.message);
    }
}

// スタッフ削除
async function deleteStaff(id) {
    if (!confirm('このスタッフを削除してもよろしいですか?')) {
        return;
    }
    
    try {
        await apiCall(`/api/staff/${id}`, 'DELETE');
        loadStaff();
        alert('スタッフを削除しました');
    } catch (error) {
        alert(error.message);
    }
}

// ========================================
// ページ切り替え
// ========================================

function switchPage(pageName) {
    document.querySelectorAll('.sidebar-menu li').forEach(li => li.classList.remove('active'));
    document.querySelector(`[data-page="${pageName}"]`).classList.add('active');
    
    document.querySelectorAll('.page-content').forEach(content => content.classList.add('hidden'));
    document.getElementById(pageName).classList.remove('hidden');

    switch(pageName) {
        case 'applications':
            loadApplications();
            break;
        case 'plans':
            loadPlans();
            break;
        case 'history':
            loadHistory();
            break;
        case 'manual-send':
            loadManualSend();
            break;
        case 'settings':
            loadSettings();
            break;
    }
}

// ========================================
// 初期化
// ========================================

document.addEventListener('DOMContentLoaded', async function() {
    // 接続テストを実行
    console.log('🔍 サーバー接続テスト開始...');
    const isConnected = await testConnection();
    
    if (!isConnected) {
        alert('サーバーに接続できません。\n\n以下を確認してください:\n1. インターネット接続\n2. サーバーのURL設定\n3. Cloud Runのデプロイ状況');
        return;
    }
    
    console.log('✅ サーバー接続OK');
    
    // トークンチェック
    if (authToken) {
        document.getElementById('loginScreen').style.display = 'none';
        document.getElementById('mainScreen').classList.add('active');
        loadApplications();
    }
    
    // ハンバーガーメニュー
    const hamburgerBtn = document.getElementById('hamburgerBtn');
    const sidebar = document.getElementById('sidebar');
    const mobileOverlay = document.getElementById('mobileOverlay');

    hamburgerBtn.addEventListener('click', function() {
        sidebar.classList.toggle('active');
        mobileOverlay.classList.toggle('active');
        hamburgerBtn.classList.toggle('hidden');
    });

    mobileOverlay.addEventListener('click', function() {
        sidebar.classList.remove('active');
        mobileOverlay.classList.remove('active');
        hamburgerBtn.classList.remove('hidden');
    });

    // サイドバーメニュー
    document.querySelectorAll('#sidebarMenu li').forEach(item => {
        item.addEventListener('click', function() {
            const page = this.getAttribute('data-page');
            switchPage(page);
            
            if (window.innerWidth <= 768) {
                sidebar.classList.remove('active');
                mobileOverlay.classList.remove('active');
                hamburgerBtn.classList.remove('hidden');
            }
        });
    });

    // ログインフォーム
    const loginForm = document.getElementById('loginForm');
    if (loginForm) {
        loginForm.addEventListener('submit', handleLogin);
    }

    // ログアウト
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', function() {
            if (confirm('ログアウトしますか?')) {
                logout();
            }
        });
    }

    // パスワード変更
    const passwordChangeForm = document.getElementById('passwordChangeForm');
    if (passwordChangeForm) {
        passwordChangeForm.addEventListener('submit', handlePasswordChange);
    }

    // OpenAI API設定
    const openaiApiForm = document.getElementById('openaiApiForm');
    if (openaiApiForm) {
        openaiApiForm.addEventListener('submit', handleOpenAIApiSave);
    }

    // NOTE認証設定
    const noteAuthForm = document.getElementById('noteAuthForm');
    if (noteAuthForm) {
        noteAuthForm.addEventListener('submit', handleNoteAuthSave);
    }

    // Scheduler同期
    const syncSchedulerBtn = document.getElementById('syncSchedulerBtn');
    if (syncSchedulerBtn) {
        syncSchedulerBtn.addEventListener('click', syncSchedulerJobs);
    }

    // チェックボックスの変更イベント
    const emailEnabledEl = document.getElementById('emailEnabled');
    const emailFrequencyEl = document.getElementById('emailFrequency');
    const noteEnabledEl = document.getElementById('noteEnabled');
    const noteFrequencyEl = document.getElementById('noteFrequency');
    
    if (emailEnabledEl) {
        emailEnabledEl.addEventListener('change', toggleEmailFields);
    }
    if (emailFrequencyEl) {
        emailFrequencyEl.addEventListener('change', toggleEmailCustomFields);
    }
    if (noteEnabledEl) {
        noteEnabledEl.addEventListener('change', toggleNoteFields);
    }
    if (noteFrequencyEl) {
        noteFrequencyEl.addEventListener('change', toggleNoteCustomFields);
    }

    // フィルターボタン
    document.querySelectorAll('#statusFilters .filter-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            document.querySelectorAll('#statusFilters .filter-btn').forEach(b => b.classList.remove('active'));
            this.classList.add('active');
            loadApplications(this.getAttribute('data-status'));
        });
    });

    // 履歴タイプフィルター
    document.querySelectorAll('[data-history-type]').forEach(btn => {
        btn.addEventListener('click', function() {
            document.querySelectorAll('[data-history-type]').forEach(b => b.classList.remove('active'));
            this.classList.add('active');
            const typeFilter = this.getAttribute('data-history-type');
            const dateFilter = document.getElementById('historyDateFilter').value;
            loadHistory(dateFilter, typeFilter);
        });
    });

    // プラン関連
    const addPlanBtn = document.getElementById('addPlanBtn');
    const savePlanBtn = document.getElementById('savePlanBtn');
    const closePlanModalBtn = document.getElementById('closePlanModalBtn');
    const closePlanModalBtn2 = document.getElementById('closePlanModalBtn2');
    
    console.log('🔍 プランボタン要素チェック:', {
        addPlanBtn: !!addPlanBtn,
        savePlanBtn: !!savePlanBtn,
        closePlanModalBtn: !!closePlanModalBtn,
        closePlanModalBtn2: !!closePlanModalBtn2
    });
    
    if (addPlanBtn) {
        addPlanBtn.addEventListener('click', showAddPlanModal);
        console.log('✅ addPlanBtn イベントリスナー登録');
    } else {
        console.warn('⚠️ addPlanBtn が見つかりません');
    }
    
    if (savePlanBtn) {
        savePlanBtn.addEventListener('click', () => {
            console.log('🖱️ savePlanBtn がクリックされました');
            savePlan();
        });
        console.log('✅ savePlanBtn イベントリスナー登録');
    } else {
        console.warn('⚠️ savePlanBtn が見つかりません');
    }
    
    if (closePlanModalBtn) {
        closePlanModalBtn.addEventListener('click', function() {
            document.getElementById('planModal').classList.remove('active');
        });
    }
    if (closePlanModalBtn2) {
        closePlanModalBtn2.addEventListener('click', function() {
            document.getElementById('planModal').classList.remove('active');
        });
    }

    // 申請者詳細モーダル
    const closeAppDetailBtn = document.getElementById('closeAppDetailBtn');
    const closeAppDetailBtn2 = document.getElementById('closeAppDetailBtn2');
    
    if (closeAppDetailBtn) {
        closeAppDetailBtn.addEventListener('click', function() {
            document.getElementById('applicationDetailModal').classList.remove('active');
        });
    }
    if (closeAppDetailBtn2) {
        closeAppDetailBtn2.addEventListener('click', function() {
            document.getElementById('applicationDetailModal').classList.remove('active');
        });
    }

    // プラン詳細モーダル
    const closePlanDetailBtn = document.getElementById('closePlanDetailBtn');
    const closePlanDetailBtn2 = document.getElementById('closePlanDetailBtn2');
    
    if (closePlanDetailBtn) {
        closePlanDetailBtn.addEventListener('click', function() {
            document.getElementById('planDetailModal').classList.remove('active');
        });
    }
    if (closePlanDetailBtn2) {
        closePlanDetailBtn2.addEventListener('click', function() {
            document.getElementById('planDetailModal').classList.remove('active');
        });
    }

    // プラン加入者検索
    const planCustomerSearch = document.getElementById('planCustomerSearch');
    if (planCustomerSearch) {
        planCustomerSearch.addEventListener('input', function() {
            if (currentPlanId) {
                loadPlanCustomers(currentPlanId, this.value);
            }
        });
    }

    // スタッフ関連
    const addStaffBtn = document.getElementById('addStaffBtn');
    const saveStaffBtn = document.getElementById('saveStaffBtn');
    const closeStaffModalBtn = document.getElementById('closeStaffModalBtn');
    const closeStaffModalBtn2 = document.getElementById('closeStaffModalBtn2');
    
    if (addStaffBtn) {
        addStaffBtn.addEventListener('click', showAddStaffModal);
    }
    if (saveStaffBtn) {
        saveStaffBtn.addEventListener('click', saveStaff);
    }
    if (closeStaffModalBtn) {
        closeStaffModalBtn.addEventListener('click', function() {
            document.getElementById('staffModal').classList.remove('active');
        });
    }
    if (closeStaffModalBtn2) {
        closeStaffModalBtn2.addEventListener('click', function() {
            document.getElementById('staffModal').classList.remove('active');
        });
    }

    // 日付フィルター
    const historyDateFilter = document.getElementById('historyDateFilter');
    if (historyDateFilter) {
        historyDateFilter.addEventListener('change', function() {
            loadHistory(this.value, currentHistoryTypeFilter);
        });
    }

    // 手動メール送信
    const manualSendForm = document.getElementById('manualSendForm');
    if (manualSendForm) {
        manualSendForm.addEventListener('submit', handleManualSend);
    }
});
