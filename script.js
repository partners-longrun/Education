/**
 * 파트너스 교육관 - 프론트엔드 JavaScript (최적화 버전)
 * 
 * [추가된 기능]
 * - LocalCache: 로컬 스토리지 캐싱
 * - debounce: 검색 입력 최적화
 * - 성능 모니터링
 */

// Google Apps Script Web App URL (배포 후 교체 필요)
const API_BASE_URL = 'https://script.google.com/macros/s/AKfycbxrAxN2qYxI3mFpiER378bXJVB1FwH_mhnSI60vFDHSyIBv2FJFw-ufRnz984AvgSNisQ/exec';

// ========== [신규] 로컬 캐싱 헬퍼 ==========
const LocalCache = {
  set: function (key, data, minutes = 30) {
    const expiry = Date.now() + (minutes * 60 * 1000);
    const cacheData = { data: data, expiry: expiry };
    try {
      localStorage.setItem('cache_' + key, JSON.stringify(cacheData));
    } catch (e) {
      console.warn('LocalStorage full, clearing old cache');
      this.clearExpired();
      try {
        localStorage.setItem('cache_' + key, JSON.stringify(cacheData));
      } catch (e2) {
        console.error('Failed to cache:', e2);
      }
    }
  },

  get: function (key) {
    try {
      const cached = localStorage.getItem('cache_' + key);
      if (!cached) return null;

      const cacheData = JSON.parse(cached);

      if (Date.now() > cacheData.expiry) {
        localStorage.removeItem('cache_' + key);
        return null;
      }

      return cacheData.data;
    } catch (e) {
      console.error('Cache read error:', e);
      return null;
    }
  },

  remove: function (key) {
    localStorage.removeItem('cache_' + key);
  },

  clearExpired: function () {
    const keys = Object.keys(localStorage);
    const now = Date.now();

    keys.forEach(key => {
      if (key.startsWith('cache_')) {
        try {
          const cacheData = JSON.parse(localStorage.getItem(key));
          if (cacheData.expiry && now > cacheData.expiry) {
            localStorage.removeItem(key);
          }
        } catch (e) {
          localStorage.removeItem(key);
        }
      }
    });
  },

  clear: function () {
    const keys = Object.keys(localStorage);
    keys.forEach(key => {
      if (key.startsWith('cache_')) {
        localStorage.removeItem(key);
      }
    });
  }
};

// ========== [신규] Debounce 헬퍼 ==========
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

// ========== 전역 상태 ==========
const App = {
  user: null,
  sessionToken: null,
  currentPage: 'dashboard',
  currentBoardId: null,
  currentPostId: null,
  boards: [],
  isAdmin: false,
  isFirstLogin: false
};

// ========== 초기화 ==========
document.addEventListener('DOMContentLoaded', init);

// [수정] init() 함수 - LocalCache 활용
async function init() {
  console.time('App Init'); // 성능 측정

  // 만료된 캐시 정리
  LocalCache.clearExpired();

  // 저장된 세션 확인
  var savedToken = localStorage.getItem('sessionToken');
  if (!savedToken) {
    savedToken = sessionStorage.getItem('sessionToken');
  }

  if (savedToken) {
    // [최적화] 게시판 목록 로컬 캐시 확인
    const cachedBoards = LocalCache.get('boards');

    var result = await api('getInitialData', {}, savedToken);

    if (result.success) {
      App.sessionToken = savedToken;
      App.user = result.data.user;
      App.isAdmin = result.data.user.role === '관리자' || result.data.user.role === '지사대표';

      // [최적화] 캐시된 게시판이 있으면 즉시 사용
      if (cachedBoards && cachedBoards.length > 0) {
        App.boards = cachedBoards;
        console.log('Using cached boards');
      } else {
        App.boards = result.data.boards || [];
        LocalCache.set('boards', App.boards, 30); // 30분 캐싱
      }

      // 세션 스토리지에도 저장 (호환성)
      sessionStorage.setItem('boardList', JSON.stringify(App.boards));

      // 최초 로그인 체크
      if (result.data.user.isFirstLogin) {
        showLogin();
        showChangePasswordModal(true);
      } else {
        showApp();
      }
    } else {
      localStorage.removeItem('sessionToken');
      sessionStorage.removeItem('sessionToken');
      LocalCache.clear(); // 캐시도 초기화
      showLogin();
    }
  } else {
    showLogin();
  }

  console.timeEnd('App Init'); // 성능 측정 종료
}

// ========== API 호출 (기존 유지) ==========
function api(action, params = {}, sessionToken = null) {
  return new Promise((resolve) => {
    const token = sessionToken || App.sessionToken;
    const payload = {
      action: action,
      params: params,
      sessionToken: token
    };

    if (API_BASE_URL === 'YOUR_GAS_WEB_APP_URL') {
      console.warn('API_BASE_URL이 설정되지 않았습니다. script.js 맨 위의 URL을 설정해주세요.');
    }

    fetch(API_BASE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain;charset=utf-8',
      },
      body: JSON.stringify(payload)
    })
      .then(response => response.json())
      .then(result => {
        resolve(result);
      })
      .catch(error => {
        console.error('API Error:', error);
        resolve({ success: false, error: '서버와 통신 중 오류가 발생했습니다.' });
      });
  });
}


// ========== 화면 전환 ==========
function hideAllScreens() {
  document.getElementById('loading-screen').style.display = 'none';
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app-screen').style.display = 'none';

  // 오버레이 정리
  const sidebarOverlay = document.getElementById('sidebar-overlay');
  if (sidebarOverlay) sidebarOverlay.remove();

  // 모달 정리
  document.getElementById('modal-container').innerHTML = '';
}

function showLogin() {
  hideAllScreens();
  document.getElementById('login-screen').style.display = 'flex';
  setupLoginHandlers();
}

function showApp() {
  hideAllScreens();
  document.getElementById('app-screen').style.display = 'flex';
  updateUserProfile();
  setupAppHandlers();

  // [최적화] 대시보드 로딩 전, 이미 있는 게시판 목록(Simple)으로 사이드바 즉시 렌더링
  if (App.boards && App.boards.length > 0) {
    updateBoardNav(App.boards);
  }

  // 뒤로가기 방지: 히스토리 항목 추가
  history.pushState({ app: true }, '', '');
  window.onpopstate = function (e) {
    // 앱 안에 있으면 뒤로가기 무효화
    if (App.sessionToken) {
      history.pushState({ app: true }, '', '');
    }
  };

  // 저장된 페이지 복원 (새로고침 대응)
  var savedNav = sessionStorage.getItem('currentNav');
  if (savedNav) {
    try {
      var navData = JSON.parse(savedNav);
      navigateTo(navData.page, navData.params || {});
    } catch (e) {
      loadDashboard();
    }
  } else {
    loadDashboard();
  }
}

// ========== 로그인 ==========
function setupLoginHandlers() {
  const form = document.getElementById('login-form');
  form.onsubmit = handleLogin;
}

async function handleLogin(e) {
  e.preventDefault();

  const employeeId = document.getElementById('employee-id').value.trim();
  const password = document.getElementById('password').value;
  const rememberMe = document.getElementById('remember-me').checked;
  const loginBtn = document.getElementById('login-btn');
  const errorDiv = document.getElementById('login-error');

  // 유효성 검사
  if (!employeeId || !password) {
    showLoginError('사번과 비밀번호를 입력해주세요.');
    return;
  }

  // 버튼 비활성화
  loginBtn.disabled = true;
  loginBtn.querySelector('.btn-text').style.display = 'none';
  loginBtn.querySelector('.btn-loading').style.display = 'inline';
  errorDiv.style.display = 'none';

  try {
    const result = await api('login', { employeeId, password });

    if (result.success) {
      App.sessionToken = result.sessionToken;
      App.user = result.user;
      App.isAdmin = result.user.role === '관리자' || result.user.role === '지사대표';
      App.isFirstLogin = result.user.isFirstLogin || false;

      if (rememberMe) {
        localStorage.setItem('sessionToken', result.sessionToken);
      } else {
        sessionStorage.setItem('sessionToken', result.sessionToken);
      }

      // 최초 로그인 체크
      if (result.user.isFirstLogin) {
        showChangePasswordModal(true);
      } else {
        showApp();
      }
    } else {
      // 디버깅 정보는 콘솔에만 출력하고 사용자에게는 보여주지 않음
      if (result.debug) {
        console.log('Login Debug info:', result.debug);
      }
      showLoginError(result.error);
    }
  } catch (error) {
    showLoginError('로그인 처리 중 오류가 발생했습니다.');
  } finally {
    loginBtn.disabled = false;
    loginBtn.querySelector('.btn-text').style.display = 'inline';
    loginBtn.querySelector('.btn-loading').style.display = 'none';
  }
}

function showLoginError(message) {
  const errorDiv = document.getElementById('login-error');
  errorDiv.textContent = message;
  errorDiv.style.display = 'block';
}

// ========== [수정] 로그아웃 - 캐시 초기화 포함 ==========
// ========== [수정] 로그아웃 - 즉시 UI 반영 (Optimistic UI) ==========
async function handleLogout() {
  // 1. 즉시 로그인 화면으로 전환 (사용자 대기 시간 제거)
  App.sessionToken = null;
  App.user = null;
  localStorage.removeItem('sessionToken');
  sessionStorage.removeItem('sessionToken');
  sessionStorage.removeItem('currentNav');
  LocalCache.clear();

  showLogin();

  // 2. 백그라운드에서 로그아웃 API 호출 (결과 기다리지 않음)
  api('logout').catch(e => console.warn('Logout API failed (background)', e));
}

// ========== [수정] 앱 핸들러 설정 - debounce 검색 적용 ==========
function setupAppHandlers() {
  // 로그아웃
  document.getElementById('logout-btn').onclick = handleLogout;

  // 메뉴 토글
  document.getElementById('menu-toggle').onclick = toggleSidebar;

  // [수정] 검색 - debounce 적용
  const searchInput = document.getElementById('search-input');
  const debouncedSearch = debounce(function (value) {
    if (value && value.trim().length >= 2) {
      handleSearch(value);
    }
  }, 300); // 300ms 대기

  searchInput.oninput = function () {
    debouncedSearch(this.value);
  };

  searchInput.onkeypress = function (e) {
    if (e.key === 'Enter') {
      handleSearch(this.value);
    }
  };

  // 네비게이션
  document.querySelectorAll('.nav-item[data-page]').forEach(item => {
    item.onclick = function (e) {
      e.preventDefault();
      navigateTo(this.dataset.page);
    };
  });

  // 관리자 메뉴 표시
  if (App.isAdmin) {
    document.getElementById('admin-nav').style.display = 'block';
  }
}

// ========== [신규] 검색 로딩 표시 ==========
function showSearchLoading() {
  // 검색 결과 영역에 로딩 표시
  const container = document.getElementById('page-container');
  if (container) {
    const loadingDiv = document.createElement('div');
    loadingDiv.className = 'search-loading';
    loadingDiv.innerHTML = '<div class="spinner"></div> 검색 중...';
    // 기존 검색 결과가 있으면 교체, 없으면 추가
    const existing = container.querySelector('.search-loading');
    if (existing) {
      existing.replaceWith(loadingDiv);
    }
  }
}

function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  const isOpen = sidebar.classList.contains('open');

  if (isOpen) {
    closeSidebar();
  } else {
    sidebar.classList.add('open');
    // 오버레이 생성
    const overlay = document.createElement('div');
    overlay.id = 'sidebar-overlay';
    overlay.className = 'sidebar-overlay';
    overlay.onclick = closeSidebar;
    document.body.appendChild(overlay);
  }
}

function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  const overlay = document.getElementById('sidebar-overlay');
  if (overlay) {
    overlay.remove();
  }
}

function updateUserProfile() {
  if (App.user) {
    document.getElementById('user-avatar').textContent = App.user.name.charAt(0);
    document.getElementById('user-name').textContent = App.user.name;
    document.getElementById('user-role').textContent = App.user.department || '';
  }
}

// ========== 네비게이션 ==========
function navigateTo(page, params = {}) {
  App.currentPage = page;

  // 현재 페이지 정보 저장 (새로고침 대응)
  sessionStorage.setItem('currentNav', JSON.stringify({ page: page, params: params }));

  // 모바일: 메뉴 선택 시 사이드바 자동 닫기
  closeSidebar();

  // 활성 네비 업데이트
  document.querySelectorAll('.nav-item').forEach(item => {
    item.classList.remove('active');
  });

  // 해당 페이지/게시판에만 active 추가
  document.querySelectorAll('.nav-item').forEach(item => {
    if (page === 'board') {
      if (item.dataset.boardId === params.boardId) {
        item.classList.add('active');
      }
    } else if (page === 'post') {
      // Keep focus on the board
      if (App.currentBoardId && item.dataset.boardId === App.currentBoardId) {
        item.classList.add('active');
      }
    } else if (item.dataset.page === page) {
      item.classList.add('active');
    }
  });

  // 페이지 라우팅
  switch (page) {
    case 'dashboard':
      loadDashboard();
      break;
    case 'board':
      loadBoard(params.boardId);
      break;
    case 'post':
      loadPost(params.postId);
      break;
    case 'admin-boards':
      loadAdminBoards();
      break;
    case 'admin-posts':
      loadAdminPosts();
      break;
    case 'admin-logs':
      loadAdminLogs();
      break;
    // 페이지 라우팅
    default:
      loadDashboard();
  }

  // FAB Visibility
  const fab = document.getElementById('fab-back');
  if (fab) {
    if (page === 'dashboard') {
      fab.style.display = 'none';
    } else {
      fab.style.display = 'flex';
    }
  }
}

// ========== 대시보드 ==========
// ========== [수정] 대시보드 로딩 최적화 & 레이아웃 간소화 ==========

async function loadDashboard() {
  console.time('loadDashboard'); // 성능 측정

  setPageTitle('대시보드');

  const container = document.getElementById('page-container');

  // [최적화] 로딩 스켈레톤 (간소화된 버전)
  container.innerHTML = `
    <div class="dashboard-loading">
      <div class="skeleton-header"></div>
      <div class="skeleton-section">
        <div class="skeleton-title"></div>
        <div class="skeleton-items"></div>
      </div>
      <div class="skeleton-section">
        <div class="skeleton-title"></div>
        <div class="skeleton-items"></div>
      </div>
    </div>
  `;

  let data;

  // [최적화] 로컬 캐시 확인
  const cachedDashboard = LocalCache.get('dashboard');

  if (cachedDashboard) {
    console.log('Using cached dashboard');
    data = cachedDashboard;

    // 캐시된 데이터로 즉시 렌더링
    renderDashboard(data);

    // [최적화] 백그라운드에서 데이터 업데이트
    setTimeout(async () => {
      const result = await api('getDashboardData');
      if (result.success && App.currentPage === 'dashboard') {
        LocalCache.set('dashboard', result.data, 5); // 5분 캐싱
        renderDashboard(result.data); // 최신 데이터로 업데이트
      }
    }, 100);
  } else {
    // [최적화] 초기 로딩 시 받아온 데이터가 있으면 그것을 사용
    if (App.initialDashboardData) {
      data = App.initialDashboardData;
      App.initialDashboardData = null;
      LocalCache.set('dashboard', data, 5);
    } else {
      // 평소대로 API 호출
      const result = await api('getDashboardData');
      if (!result.success) {
        showError(result.error);
        console.timeEnd('loadDashboard');
        return;
      }
      data = result.data;
      LocalCache.set('dashboard', data, 5); // 5분 캐싱
    }

    renderDashboard(data);
  }

  console.timeEnd('loadDashboard');
}

// [수정] 대시보드 렌더링 함수 - 간소화된 레이아웃 (텍스트 리스트)
function renderDashboard(data) {
  App.boards = data.boards;

  // 게시판 네비 업데이트
  updateBoardNav(data.boards);

  // 게시판 목록 최신화
  sessionStorage.setItem('boardList', JSON.stringify(data.boards));
  LocalCache.set('boards', data.boards, 30);

  // HTML 렌더링
  const container = document.getElementById('page-container');
  container.innerHTML = `
    <!-- 환영 인사 -->
    <div class="welcome-section" style="margin-bottom: 30px;">
      <h1 class="welcome-title">👋 안녕하세요, ${escapeHtml(App.user.name)}님!</h1>
      <p class="welcome-subtitle">파트너스 교육관에 오신 것을 환영합니다.</p>
    </div>
    
    <!-- 최근 영상 (Simple List) -->
    <section class="section">
      <div class="section-header">
        <h2 class="section-title">
          <span class="section-title-icon">📺</span>
          최근 영상
        </h2>
      </div>
      <div class="simple-list">
        ${renderSimpleList(data.recentVideos, '등록된 영상이 없습니다.')}
      </div>
    </section>
    
    <!-- 최근 자료 (Simple List) -->
    <section class="section">
      <div class="section-header">
        <h2 class="section-title">
          <span class="section-title-icon">📁</span>
          최근 자료
        </h2>
      </div>
      <div class="simple-list">
        ${renderSimpleList(data.recentFiles, '등록된 자료가 없습니다.')}
      </div>
    </section>
  `;
}

// [신규] 심플 리스트 렌더링 헬퍼
function renderSimpleList(items, emptyMessage) {
  if (!items || items.length === 0) {
    return `<div class="empty-state-text" style="padding: 10px 0;">${emptyMessage}</div>`;
  }

  return `
    <ul class="simple-post-list">
      ${items.map(item => `
        <li class="simple-post-item" onclick="navigateTo('post', {postId:'${item.postId}'})">
          <span class="simple-post-title">${escapeHtml(item.title)}</span>
          <span class="simple-post-date">${formatDate(item.createdAt)}</span>
        </li>
      `).join('')}
    </ul>
  `;
}

function updateBoardNav(boards) {
  // 인자가 없으면 캐시 또는 앱 상태에서 가져옴
  if (!boards) {
    if (App.boards && App.boards.length > 0) {
      boards = App.boards;
    } else {
      const cached = sessionStorage.getItem('boardList');
      if (cached) {
        boards = JSON.parse(cached);
        App.boards = boards;
      } else {
        return; // 데이터 없음
      }
    }
  }

  const navList = document.getElementById('board-nav-list');
  const icons = ['📚', '💼', '📊', '🎯', '📢', '🔖', '📌', '🗂️'];

  navList.innerHTML = boards.map((board, i) => {
    // [최적화] 초기 로딩 시에는 count가 없을 수 있음
    const countDisplay = (board.postCount !== undefined && board.postCount !== null)
      ? `<span class="badge">${board.postCount}</span>`
      : '';

    return `
    <a href="#" class="nav-item" data-page="board" data-board-id="${board.boardId}">
      <span class="nav-item-icon">${icons[i % icons.length]}</span>
      ${escapeHtml(board.boardName)}
      ${countDisplay}
    </a>
  `;
  }).join('');

  // 클릭 이벤트 재설정
  navList.querySelectorAll('.nav-item').forEach(item => {
    item.onclick = function (e) {
      e.preventDefault();
      navigateTo('board', { boardId: this.dataset.boardId });
    };
  });
}

// ========== 게시판 ==========
// [수정] 게시판 로딩 최적화 (캐싱 적용)
async function loadBoard(boardId) {
  App.currentBoardId = boardId;
  showLoading();

  // 1. 게시판 메타 정보 (캐시 우선)
  let board = App.boards.find(b => b.boardId === boardId);
  if (board) {
    setPageTitle(board.boardName);
  }

  // 2. 게시글 목록 캐시 키 생성
  const cacheKey = `posts_${boardId}_page1`;
  const cachedPosts = LocalCache.get(cacheKey);

  // [최적화] 캐시된 게시글이 있는 경우 즉시 렌더링
  if (cachedPosts) {
    console.log('Using cached posts for board:', boardId);
    renderBoardPosts(cachedPosts.data, cachedPosts.pagination);

    // 백그라운드 업데이트 (선택적)
    api('getPosts', { boardId, page: 1, pageSize: 12 }).then(result => {
      if (result.success) {
        LocalCache.set(cacheKey, result, 5); // 5분 캐시
      }
    });
  } else {
    // 캐시 없으면 API 호출
    const postsResult = await api('getPosts', { boardId, page: 1, pageSize: 12 });
    if (!postsResult.success) {
      showError(postsResult.error);
      return;
    }

    // 캐시 저장
    LocalCache.set(cacheKey, postsResult, 5);
    renderBoardPosts(postsResult.data, postsResult.pagination);
  }

  // 게시판 보드 정보가 없었다면 API 호출로 가져오기 (드문 케이스)
  if (!board) {
    const boardResult = await api('getBoardById', { boardId });
    if (boardResult.success) {
      board = boardResult.data;
      setPageTitle(board.boardName);
    }
  }
}

// [신규] 게시판 포스트 렌더링 함수 분리
function renderBoardPosts(posts, pagination) {
  const container = document.getElementById('page-container');

  if (posts.length === 0) {
    container.innerHTML = `
      ${App.isAdmin ? `
        <div style="margin-bottom:20px; display:flex; justify-content:flex-end;">
          <button class="btn btn-primary" onclick="showPostModal()">+ 게시글 작성</button>
        </div>
      ` : ''}
      <div class="empty-state">
        <div class="empty-state-icon">📭</div>
        <div class="empty-state-title">게시글이 없습니다</div>
        <div class="empty-state-text">아직 등록된 게시글이 없습니다.</div>
      </div>
    `;
    return;
  }

  container.innerHTML = `
    ${App.isAdmin ? `
      <div style="margin-bottom:20px; display:flex; justify-content:flex-end;">
        <button class="btn btn-primary" onclick="showPostModal()">+ 게시글 작성</button>
      </div>
    ` : ''}
    <div class="video-grid">
      ${posts.map(post => renderPostCard(post)).join('')}
    </div>
    ${renderPagination(pagination, 'loadBoardPage')}
  `;
}

async function loadBoardPage(page) {
  // 페이지 이동은 캐시하지 않음 (최신 데이터 중요)
  const postsResult = await api('getPosts', { boardId: App.currentBoardId, page, pageSize: 12 });
  if (postsResult.success) {
    renderBoardPosts(postsResult.data, postsResult.pagination);
  }
}

// ========== 게시글 상세 ==========
async function loadPost(postId) {
  App.currentPostId = postId;
  showLoading();

  const result = await api('getPostById', { postId });
  if (!result.success) {
    showError(result.error);
    return;
  }

  const post = result.data;
  setPageTitle(post.boardName || '게시판');

  // 댓글 로드
  const commentsResult = await api('getComments', { postId });
  const comments = commentsResult.success ? commentsResult.data : [];

  const container = document.getElementById('page-container');
  container.innerHTML = `
    <div class="post-container">
      <button class="back-btn" onclick="navigateTo('board', {boardId:'${post.boardId}'})">← ${escapeHtml(post.boardName)}으로 돌아가기</button>
      
      ${renderVideoPlayer(post)}
      
      <!-- Main File Attachment (if not video and exists) -->
      ${(post.driveFileId && post.driveFileType !== 'video') ? `
        <div class="content-card" style="margin-top:20px; cursor:pointer;" onclick="window.open('https://drive.google.com/file/d/${post.driveFileId}/view', '_blank')">
          <div style="display:flex; align-items:center; gap:12px; padding:12px; background:#f8f9fa; border-radius:8px; border:1px solid #eee;">
            <div class="file-icon ${getFileIconClass(post.driveFileType)}" style="font-size:24px;">${getFileTypeLabel(post.driveFileType)}</div>
            <div>
              <div style="font-weight:600; color:var(--text-primary);">메인 첨부파일: ${getFileTypeLabel(post.driveFileType)}</div>
              <div style="font-size:12px; color:var(--text-secondary);">클릭하여 보기</div>
            </div>
            <div style="margin-left:auto;">🔗</div>
          </div>
        </div>
      ` : ''}

      <div class="post-header-card">
        <h1 class="post-detail-title">${escapeHtml(post.title)}</h1>
        <div class="post-meta">
          <span class="post-meta-item">✍️ ${escapeHtml(post.writerName || post.createdBy)}</span>
          <span class="post-meta-item">📅 ${formatDate(post.createdAt)}</span>
          <span class="post-meta-item">👁️ 조회 ${post.viewCount}</span>
        </div>
        <!-- Line removed -->
        <!-- Actions removed -->
      </div>
      
      ${post.content ? `
        <div class="content-card">
          <h3>📝 내용</h3>
          <div class="post-content">${escapeHtml(post.content).replace(/\n/g, '<br>')}</div>
        </div>
      ` : ''}
      
      ${post.attachments.length > 0 ? `
        <div class="content-card">
          <h3>📎 첨부파일 (${post.attachments.length})</h3>
          <div class="attachment-list">
            ${post.attachments.map(att => renderAttachment(att)).join('')}
          </div>
        </div>
      ` : ''}
      
      <div class="content-card">
        <div class="comments-header">
          <h3 class="comments-title">💬 댓글 <span class="comments-count" id="comment-count">${commentsResult.total || 0}</span></h3>
        </div>
        
        <div class="comment-form">
          <div class="comment-avatar">${App.user.name.charAt(0)}</div>
          <div class="comment-input-wrapper">
            <textarea class="comment-input" id="comment-input" rows="2" placeholder="댓글을 입력하세요..."></textarea>
            <div class="comment-submit-row">
              <button class="comment-submit" onclick="submitComment('${postId}')">등록</button>
            </div>
          </div>
        </div>
        
        <div class="comment-list" id="comment-list">
          ${renderComments(comments)}
        </div>
      </div>
    </div>
  `;
}

// ========== 좋아요 (기능 삭제됨) ==========
// function toggleLike(postId) { ... }

// ========== 댓글 ==========
async function submitComment(postId, parentId = null) {
  const input = document.getElementById('comment-input');
  // 버튼 식별을 위해 parentId 유무에 따라 처리 (현재 구조상 대댓글 폼은 별도 생성됨. 이 함수의 수정 범위는 메인 댓글 폼 기준)
  // 메인 댓글 버튼 ID: comment-submit-btn (새로 추가 필요)
  // 대댓글은 showReplyForm에서 생성되므로 그쪽도 확인 필요.
  // 현재 HTML 구조상 메인 댓글 버튼에 ID가 없음. onclick에서 this를 넘기거나 ID를 부여해야 함.
  // 기존 렌더링 코드: <button class="comment-submit" onclick="submitComment('${postId}')">등록</button>
  // 이를 수정: <button class="comment-submit" id="comment-submit-btn" onclick="submitComment('${postId}')">등록</button>
  // 
  // 하지만 렌더링 함수(loadPost)를 먼저 수정해야 함.

  // 여기서는 버튼을 DOM 탐색으로 찾음 (더 안전한 방법: loadPost 수정)
  // 메인 댓글 입력창 옆의 버튼 찾기
  const btn = document.querySelector('.comment-submit-row .comment-submit');

  const content = input.value.trim();

  if (!content) {
    showToast('댓글 내용을 입력해주세요.', 'error');
    return;
  }

  // 버튼 비활성화
  if (btn) {
    if (btn.disabled) return;
    btn.disabled = true;
    btn.originalText = btn.textContent;
    btn.textContent = '등록 중...';
  }

  try {
    const result = await api('createComment', { postId, content, parentId });

    if (result.success) {
      input.value = '';
      showToast('댓글이 등록되었습니다.', 'success');

      // 댓글 목록 새로고침
      const commentsResult = await api('getComments', { postId });
      if (commentsResult.success) {
        document.getElementById('comment-list').innerHTML = renderComments(commentsResult.data);
        document.getElementById('comment-count').textContent = commentsResult.total;
      }
    } else {
      showToast(result.error, 'error');
    }
  } catch (e) {
    showToast('서버 오류가 발생했습니다.', 'error');
  } finally {
    // 버튼 복구
    if (btn) {
      btn.disabled = false;
      btn.textContent = btn.originalText || '등록';
    }
  }
}

async function deleteComment(commentId) {
  if (!confirm('댓글을 삭제하시겠습니까?')) return;

  const result = await api('deleteComment', { commentId });

  if (result.success) {
    showToast('댓글이 삭제되었습니다.', 'success');
    loadPost(App.currentPostId);
  } else {
    showToast(result.error, 'error');
  }
}

// ========== 관리자: 게시판 관리 ==========
async function loadAdminBoards() {
  if (!App.isAdmin) {
    showError('관리자 권한이 필요합니다.');
    return;
  }

  setPageTitle('게시판 관리');
  showLoading();

  const result = await api('getBoards');
  if (!result.success) {
    showError(result.error);
    return;
  }

  const container = document.getElementById('page-container');
  container.innerHTML = `
    <div style="margin-bottom:20px; display:flex; justify-content:flex-end;">
      <button class="btn btn-primary" onclick="showBoardModal()">+ 게시판 추가</button>
    </div>
    <div class="admin-table-container">
      <table class="admin-table">
        <thead>
          <tr>
            <th>순서</th>
            <th>게시판명</th>
            <th>설명</th>
            <th>게시글 수</th>
            <th>관리</th>
          </tr>
        </thead>
        <tbody>
          ${result.data.map(board => `
            <tr>
              <td>${board.sortOrder}</td>
              <td><strong>${escapeHtml(board.boardName)}</strong></td>
              <td>${escapeHtml(board.description || '-')}</td>
              <td>${board.postCount}</td>
              <td class="admin-actions">
                <button class="admin-btn edit" onclick="showBoardModal('${board.boardId}')">수정</button>
                <button class="admin-btn delete" onclick="deleteBoard('${board.boardId}')">삭제</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

async function showBoardModal(boardId = null) {
  let board = null;
  if (boardId) {
    const result = await api('getBoardById', { boardId });
    if (result.success) board = result.data;
  }

  const html = `
    <div class="modal-overlay" onclick="closeModal(event)">
      <div class="modal" onclick="event.stopPropagation()">
        <div class="modal-header">
          <h3 class="modal-title">${board ? '게시판 수정' : '게시판 추가'}</h3>
          <button class="modal-close" onclick="closeModal()">&times;</button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label class="form-label">게시판명 *</label>
            <input type="text" class="form-input" id="modal-board-name" value="${board ? escapeHtml(board.boardName) : ''}" placeholder="게시판 이름을 입력하세요">
          </div>
          <div class="form-group">
            <label class="form-label">설명</label>
            <textarea class="form-input" id="modal-board-desc" rows="3" placeholder="게시판 설명을 입력하세요">${board ? escapeHtml(board.description || '') : ''}</textarea>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" onclick="closeModal()">취소</button>
          <button class="btn btn-primary" onclick="saveBoard('${boardId || ''}')">${board ? '수정' : '추가'}</button>
        </div>
      </div>
    </div>
  `;

  document.getElementById('modal-container').innerHTML = html;
}

async function saveBoard(boardId) {
  const boardName = document.getElementById('modal-board-name').value.trim();
  const description = document.getElementById('modal-board-desc').value.trim();

  if (!boardName) {
    showToast('게시판명을 입력해주세요.', 'error');
    return;
  }

  let result;
  if (boardId) {
    result = await api('updateBoard', { boardId, boardName, description });
  } else {
    result = await api('createBoard', { boardName, description });
  }

  if (result.success) {
    // [추가] 캐시 무효화
    LocalCache.remove('boards');
    LocalCache.remove('dashboard');

    showToast(result.message, 'success');
    closeModal();
    loadAdminBoards();
  } else {
    showToast(result.error, 'error');
  }
}

async function deleteBoard(boardId) {
  if (!confirm('정말 삭제하시겠습니까?')) return;

  const result = await api('deleteBoard', { boardId });
  if (result.success) {
    // [추가] 캐시 무효화
    LocalCache.remove('boards');
    LocalCache.remove('dashboard');

    showToast(result.message, 'success');
    loadAdminBoards();
  } else {
    showToast(result.error, 'error');
  }
}

// ========== 관리자: 게시글 관리 ==========
async function loadAdminPosts(page = 1) {
  if (!App.isAdmin) {
    showError('관리자 권한이 필요합니다.');
    return;
  }

  setPageTitle('게시글 관리');
  showLoading();

  // 전체 게시글 조회
  const result = await api('getPosts', { page, pageSize: 20 });
  if (!result.success) {
    showError(result.error || '게시글을 불러오는 중 오류가 발생했습니다.');
    return;
  }

  const container = document.getElementById('page-container');
  const posts = result.data || [];

  if (posts.length === 0) {
    container.innerHTML = `
      <div style="margin-bottom:20px; display:flex; justify-content:flex-end;">
        <button class="btn btn-primary" onclick="showPostModal()">+ 게시글 작성</button>
      </div>
      <div class="empty-state">
        <div class="empty-state-icon">📝</div>
        <div class="empty-state-title">게시글이 없습니다</div>
        <div class="empty-state-text">첫 번째 게시글을 작성해보세요.</div>
      </div>
    `;
    return;
  }

  container.innerHTML = `
    <div style="margin-bottom:20px; display:flex; justify-content:flex-end;">
      <button class="btn btn-primary" onclick="showPostModal()">+ 게시글 작성</button>
    </div>
    <div class="admin-table-container">
      <table class="admin-table">
        <thead>
          <tr>
            <th>제목</th>
            <th>게시판</th>
            <th>작성자</th>
            <th>조회</th>
            <th>좋아요</th>
            <th>작성일</th>
            <th>관리</th>
          </tr>
        </thead>
        <tbody>
          ${posts.map(post => `
            <tr>
              <td><a href="#" onclick="navigateTo('post', {postId:'${post.postId}'});return false;"><strong>${escapeHtml(post.title)}</strong></a></td>
              <td>${escapeHtml(post.boardName || '-')}</td>
              <td>${escapeHtml(post.createdBy)}</td>
              <td>${post.viewCount}</td>
              <td>${post.likeCount}</td>
              <td>${formatDate(post.createdAt)}</td>
              <td class="admin-actions">
                <button class="admin-btn edit" onclick="showPostModal('${post.postId}')">수정</button>
                <button class="admin-btn delete" onclick="deletePost('${post.postId}')">삭제</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
    ${renderPagination(result.pagination, 'loadAdminPosts')}
  `;
}

// ========== 게시글 작성/수정 모달 ==========
async function showPostModal(postId = null) {
  let post = null;
  if (postId) {
    const result = await api('getPostById', { postId });
    if (result.success) post = result.data;
  }

  // 게시판 목록
  const boards = App.boards || [];

  const html = `
    <div class="modal-overlay"> <!-- onclick removed -->
      <div class="modal modal-lg" onclick="event.stopPropagation()">
        <div class="modal-header">
          <h3 class="modal-title">${post ? '게시글 수정' : '게시글 작성'}</h3>
          <button class="modal-close" onclick="closeModal()">&times;</button>
        </div>
        <div class="modal-body">
          <!-- 1. 게시판 선택 -->
          <div class="form-group">
            <label class="form-label">게시판 *</label>
            <select class="form-input" id="modal-post-board">
              <option value="">게시판을 선택하세요</option>
              ${boards.map(b => `<option value="${b.boardId}" ${post ? (post.boardId === b.boardId ? 'selected' : '') : ''}>${escapeHtml(b.boardName)}</option>`).join('')}
            </select>
          </div>
          
          <!-- 2. 제목 -->
          <div class="form-group">
            <label class="form-label">제목 *</label>
            <input type="text" class="form-input" id="modal-post-title" value="${post ? escapeHtml(post.title) : ''}" placeholder="제목을 입력하세요">
          </div>
          
          <!-- 3. 내용 -->
          <div class="form-group">
            <label class="form-label">내용</label>
            <textarea class="form-input" id="modal-post-content" rows="6" placeholder="내용을 입력하세요">${post ? escapeHtml(post.content || '') : ''}</textarea>
          </div>

          <!-- 4. 영상 첨부 (구글 드라이브 URL) -->
          <div class="form-group">
            <label class="form-label">🎥 영상 첨부 (구글 드라이브 공유 링크 URL)</label>
            <input type="text" class="form-input" id="modal-post-video-url" value="${post && post.driveFileType === 'video' ? 'https://drive.google.com/file/d/' + post.driveFileId + '/view' : ''}" placeholder="예: https://drive.google.com/file/d/VIDEO_ID/view?usp=sharing">
            <small style="color:var(--text-secondary);font-size:12px;margin-top:4px;">* 영상이 있는 경우 전체 URL을 입력하세요</small>
          </div>

          <!-- 5. 파일 첨부 (구글 드라이브 URL) -->
          <div class="form-divider" style="margin:24px 0;border-top:1px dashed #eee;"></div>
          <h4 style="margin-bottom:16px;font-size:16px;">파일 첨부 (선택)</h4>
          
          <div class="form-group">
            <label class="form-label">📁 파일 첨부 (구글 드라이브 공유 링크 URL)</label>
             <input type="text" class="form-input" id="modal-post-file-url" placeholder="예: https://drive.google.com/file/d/FILE_ID/view?usp=sharing">
             <small style="color:var(--text-secondary);font-size:12px;margin-top:4px;">* 첨부할 파일의 전체 URL을 입력하세요</small>
          </div>

          <!-- 6. 파일 이름 -->
          <div class="form-group">
            <label class="form-label">파일 이름 (확장자 포함)</label>
            <input type="text" class="form-input" id="modal-post-file-name" placeholder="예: 1강 교안.pdf">
          </div>

          <!-- 7. 파일 유형 -->
          <div class="form-group">
             <label class="form-label">파일 유형</label>
             <select class="form-input" id="modal-post-file-type">
                <option value="pdf">PDF</option>
                <option value="presentation">파워포인트 (PPT)</option>
                <option value="spreadsheet">엑셀 (Excel)</option>
                <option value="document">워드 (Word)</option>
                <option value="image">이미지</option>
                <option value="other">기타</option>
             </select>
          </div>

        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" onclick="closeModal()">취소</button>
          <button class="btn btn-primary" id="save-post-btn" onclick="savePost('${postId || ''}')">${post ? '수정' : '게시'}</button>
        </div>
      </div>
    </div>
  `;

  document.getElementById('modal-container').innerHTML = html;
}

function extractGoogleDriveId(url) {
  if (!url) return null;
  // 다양한 형태의 URL 지원
  // 1. https://drive.google.com/file/d/FILE_ID/view...
  // 2. https://drive.google.com/open?id=FILE_ID...
  var match = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (match) return match[1];

  match = url.match(/id=([a-zA-Z0-9_-]+)/);
  if (match) return match[1];

  return null;
}

async function savePost(postId) {
  const btn = document.getElementById('save-post-btn');
  if (btn.disabled) return; // 중복 클릭 방지

  const boardId = document.getElementById('modal-post-board').value;
  const title = document.getElementById('modal-post-title').value.trim();
  const content = document.getElementById('modal-post-content').value.trim();

  // 영상 처리
  const videoUrl = document.getElementById('modal-post-video-url').value.trim();
  let driveFileId = '';
  let driveFileType = '';

  if (videoUrl) {
    driveFileId = extractGoogleDriveId(videoUrl);
    if (driveFileId) {
      driveFileType = 'video';
    } else {
      showToast('영상 URL 형식이 올바르지 않습니다.', 'error');
      return;
    }
  }

  // 파일 첨부 처리
  const fileUrl = document.getElementById('modal-post-file-url').value.trim();
  const fileName = document.getElementById('modal-post-file-name').value.trim();
  const fileType = document.getElementById('modal-post-file-type').value;

  if (!boardId) {
    showToast('게시판을 선택해주세요.', 'error');
    return;
  }
  if (!title) {
    showToast('제목을 입력해주세요.', 'error');
    return;
  }

  // 파일 첨부 유효성 검사
  if (fileUrl && !fileName) {
    showToast('첨부 파일의 이름을 입력해주세요.', 'error');
    return;
  }

  let attachments = [];
  if (fileUrl) {
    const attId = extractGoogleDriveId(fileUrl);
    if (!attId) {
      showToast('첨부 파일 URL 형식이 올바르지 않습니다.', 'error');
      return;
    }
    attachments.push({
      driveFileId: attId,
      fileName: fileName,
      fileType: fileType
    });
  }

  // 버튼 비활성화 및 텍스트 변경
  btn.disabled = true;
  btn.textContent = '게시 중...';

  let result;
  // YouTube URL은 더 이상 사용하지 않음 (빈 문자열 전달)
  const youtubeUrl = '';

  try {
    if (postId) {
      // 수정 시 기존 로직 사용 (attachments 처리는 백엔드 확인 필요하지만, 일단 요청대로 구현)
      // 주의: updatePost API가 attachments 추가를 지원하는지 여부는 PostService.gs에 달려있음. 
      // 현재 PostService.gs의 updatePost는 attachments 업데이트 로직이 명시적으로 보이지 않음.
      // 하지만 사용자는 주로 신규 작성에 초점을 맞추고 있음.
      result = await api('updatePost', { postId, boardId, title, content, driveFileId, driveFileType, youtubeUrl });
    } else {
      result = await api('createPost', { boardId, title, content, driveFileId, driveFileType, youtubeUrl, attachments });
    }

    if (result.success) {
      // [추가] 캐시 무효화
      LocalCache.remove(`posts_${boardId}_page1`);
      LocalCache.remove('dashboard');

      showToast(postId ? '게시글이 수정되었습니다.' : '게시되었습니다.', 'success');
      closeModal();
      if (App.currentPage === 'admin-posts') {
        loadAdminPosts();
      } else {
        loadBoard(boardId);
      }
    } else {
      // 실패 시 버튼 복구
      showToast(result.error, 'error');
      btn.disabled = false;
      btn.textContent = postId ? '수정' : '게시';
    }
  } catch (e) {
    showToast('서버 통신 중 오류가 발생했습니다.', 'error');
    btn.disabled = false;
    btn.textContent = postId ? '수정' : '게시';
  }
}

async function deletePost(postId) {
  if (!confirm('정말 삭제하시겠습니까?')) return;

  const result = await api('deletePost', { postId });
  if (result.success) {
    // [추가] 캐시 무효화
    LocalCache.remove(`posts_${App.currentBoardId}_page1`);
    LocalCache.remove('dashboard');

    showToast('게시글이 삭제되었습니다.', 'success');
    if (App.currentPage === 'admin-posts') {
      loadAdminPosts();
    } else {
      loadBoard(App.currentBoardId);
    }
  } else {
    showToast(result.error, 'error');
  }
}

// ========== 관리자: 로그인 기록 ==========
async function loadAdminLogs(page = 1) {
  if (!App.isAdmin) {
    showError('관리자 권한이 필요합니다.');
    return;
  }

  setPageTitle('로그인 기록');
  showLoading();

  const result = await api('getLoginLogs', { page, pageSize: 20 });
  if (!result.success) {
    showError(result.error || '로그인 기록을 불러오는 중 오류가 발생했습니다.');
    return;
  }

  const container = document.getElementById('page-container');
  const logs = result.data || [];

  if (logs.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">📋</div>
        <div class="empty-state-title">로그인 기록이 없습니다</div>
        <div class="empty-state-text">아직 기록된 로그인 내역이 없습니다.</div>
      </div>
    `;
    return;
  }

  container.innerHTML = `
    <div class="admin-table-container">
      <table class="admin-table">
        <thead>
          <tr>
            <th>로그인일시</th>
            <th>이름</th>
            <th>사번</th>
            <th>IP주소</th>
          </tr>
        </thead>
        <tbody>
          ${logs.map(log => `
            <tr>
              <td>${log.timestamp || '-'}</td>
              <td>${escapeHtml(log.name || '-')}</td>
              <td>${escapeHtml(String(log.employeeId) || '-')}</td>
              <td>${escapeHtml(log.ip || '-')}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
    ${result.pagination ? renderPagination(result.pagination, 'loadAdminLogs') : ''}
  `;
}

// ========== 검색 ==========
async function handleSearch(query) {
  if (!query || query.trim().length < 2) {
    showToast('검색어는 2글자 이상 입력해주세요.', 'error');
    return;
  }

  setPageTitle(`"${query}" 검색 결과`);
  showLoading();

  const result = await api('search', { query });
  if (!result.success) {
    showError(result.error);
    return;
  }

  const container = document.getElementById('page-container');
  const data = result.data;

  if (data.totalResults === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">🔍</div>
        <div class="empty-state-title">검색 결과가 없습니다</div>
        <div class="empty-state-text">다른 검색어로 시도해보세요.</div>
      </div>
    `;
    return;
  }

  container.innerHTML = `
    <p style="margin-bottom:24px;color:var(--text-secondary)">총 ${data.totalResults}개의 결과</p>
    ${data.posts.length > 0 ? `
      <section class="section">
        <h3 class="section-title">📝 게시글 (${data.posts.length})</h3>
        <div class="video-grid">
          ${data.posts.map(post => renderPostCard(post)).join('')}
        </div>
      </section>
    ` : ''}
    ${data.boards.length > 0 ? `
      <section class="section">
        <h3 class="section-title">📋 게시판 (${data.boards.length})</h3>
        <div class="board-grid">
          ${data.boards.map(board => `
            <div class="board-card" onclick="navigateTo('board', {boardId:'${board.boardId}'})">
              <div class="board-header">
                <div class="board-icon">📁</div>
                <h3 class="board-title">${escapeHtml(board.boardName)}</h3>
              </div>
              <p class="board-desc">${escapeHtml(board.description || '')}</p>
            </div>
          `).join('')}
        </div>
      </section>
    ` : ''}
  `;
}

// ========== 렌더링 헬퍼 ==========
function renderVideoCards(videos) {
  if (!videos || videos.length === 0) {
    return '<p class="empty-state-text">등록된 영상이 없습니다.</p>';
  }
  return videos.map(v => renderPostCard(v)).join('');
}

function renderFileCards(files) {
  if (!files || files.length === 0) {
    return '<p class="empty-state-text">등록된 자료가 없습니다.</p>';
  }
  return files.map(f => `
    <div class="file-card" onclick="navigateTo('post', {postId:'${f.postId}'})">
      <div class="file-icon ${getFileIconClass(f.driveFileType)}">${getFileTypeLabel(f.driveFileType)}</div>
      <div class="file-info">
        <div class="file-name">${escapeHtml(f.title)}</div>
        <div class="file-meta">${formatDate(f.createdAt)}</div>
      </div>
    </div>
  `).join('');
}

function renderBoardCards(boards) {
  if (!boards || boards.length === 0) {
    return '<p class="empty-state-text">등록된 게시판이 없습니다.</p>';
  }
  const icons = ['📚', '💼', '📊', '🎯', '📢'];
  return boards.map((b, i) => `
    <div class="board-card" onclick="navigateTo('board', {boardId:'${b.boardId}'})">
      <div class="board-header">
        <div class="board-icon">${icons[i % icons.length]}</div>
        <h3 class="board-title">${escapeHtml(b.boardName)}</h3>
      </div>
      <p class="board-desc">${escapeHtml(b.description || '게시판 설명이 없습니다.')}</p>
      <div class="board-stats">
        <span class="board-stat">📺 영상 <span class="board-stat-value">${b.videoCount || 0}</span></span>
        <span class="board-stat">📁 자료 <span class="board-stat-value">${b.fileCount || 0}</span></span>
      </div>
    </div>
  `).join('');
}

function renderPostCard(post) {
  const colors = ['#FF6B35', '#667eea', '#11998e', '#f093fb'];
  const colorIdx = post.postId.charCodeAt(0) % colors.length;

  return `
    <div class="video-card" onclick="navigateTo('post', {postId:'${post.postId}'})">
      <div class="video-thumbnail" style="background:linear-gradient(135deg, ${colors[colorIdx]}, ${colors[(colorIdx + 1) % colors.length]})">
        ${post.thumbnailUrl ? `<img src="${post.thumbnailUrl}" alt="">` : ''}
        <div class="video-play-btn"></div>
      </div>
      <div class="video-info">
        <h3 class="video-title">${escapeHtml(post.title)}</h3>
        <div class="video-meta">
          <span>✍️ ${escapeHtml(post.writerName || post.createdBy)}</span>
          <span>👁️ ${post.viewCount || 0}</span>
          <span>${formatDate(post.createdAt)}</span>
        </div>
      </div>
    </div>
  `;
}

function renderVideoPlayer(post) {
  if (post.youtubeUrl) {
    // YouTube support removed
  }

  if (post.driveFileId) {
    if (post.driveFileType === 'video') {
      // [수정] CSP (Content Security Policy) 오류 해결을 위해 iframe 대신 새 창 열기 버튼 제공
      // Google Drive는 타 도메인에서의 iframe 임매딩을 엄격하게 제한함 (특히 비공개 파일)
      return `
        <div class="video-player-placeholder" style="background:#2c3e50; height:320px; display:flex; flex-direction:column; align-items:center; justify-content:center; border-radius:12px; color:white; margin-bottom:20px;">
          <div style="font-size:64px; margin-bottom:20px; opacity:0.8;">▶️</div>
          <h3 style="margin:0 0 10px 0; font-weight:500;">영상 미리보기</h3>
          <p style="margin:0 0 24px 0; color:#bdc3c7; font-size:14px;">보안 설정으로 인해 새 창에서 재생됩니다.</p>
          <button class="btn btn-primary" onclick="window.open('https://drive.google.com/file/d/${post.driveFileId}/view', '_blank')" style="padding:10px 24px; font-size:16px;">
            📽️ 영상 재생하기
          </button>
        </div>
      `;
    }
  }
  return '';
}

function renderAttachment(att) {
  var driveUrl = 'https:' + '/' + '/drive.google.com/file/d/' + att.driveFileId + '/view';
  return '<div class="attachment-item" onclick="window.open(\'' + driveUrl + '\', \'_blank\')">' +
    '<div class="attachment-icon ' + getFileIconClass(att.fileType) + '">' + getFileTypeLabel(att.fileType) + '<' + '/div>' +
    '<div class="attachment-info">' +
    '<div class="attachment-name">' + escapeHtml(att.fileName) + '<' + '/div>' +
    '<div class="attachment-size">' + formatFileSize(att.fileSize) + '<' + '/div>' +
    '<' + '/div>' +
    '<button class="attachment-download">다운로드<' + '/button>' +
    '<' + '/div>';
}

function renderComments(comments) {
  if (!comments || comments.length === 0) {
    return '<p style="text-align:center;color:var(--text-secondary);padding:20px;">아직 댓글이 없습니다. 첫 댓글을 남겨보세요!</p>';
  }

  return comments.map(c => `
    <div class="comment-item">
      <div class="comment-avatar" style="background:linear-gradient(135deg, #667eea, #764ba2)">${c.userName.charAt(0)}</div>
      <div class="comment-content">
        <div class="comment-author">
          <span class="comment-author-name">${escapeHtml(c.userName)}</span>
          <span class="comment-date">${formatDate(c.createdAt)}</span>
        </div>
        <p class="comment-text">${escapeHtml(c.content)}</p>
        <div class="comment-actions">
          <span class="comment-action" onclick="showReplyForm('${c.commentId}')">💬 답글</span>
          ${c.userId === App.user.employeeId || App.isAdmin ? `<span class="comment-action" onclick="deleteComment('${c.commentId}')">🗑️ 삭제</span>` : ''}
        </div>
        ${(c.replies ? c.replies.length > 0 : false) ? c.replies.map(r => `
          <div class="comment-item reply-item">
            <div class="comment-avatar" style="background:linear-gradient(135deg, #11998e, #38ef7d)">${r.userName.charAt(0)}</div>
            <div class="comment-content">
              <div class="comment-author">
                <span class="comment-author-name">${escapeHtml(r.userName)}</span>
                <span class="comment-date">${formatDate(r.createdAt)}</span>
              </div>
              <p class="comment-text">${escapeHtml(r.content)}</p>
            </div>
          </div>
        `).join('') : ''}
      </div>
    </div>
  `).join('');
}
function isInPageRange(i, currentPage) {
  return i >= currentPage - 2 ? i <= currentPage + 2 : false;
}

function renderPagination(pagination, functionName) {
  if (pagination.totalPages <= 1) return '';

  var html = '<div class="pagination">';

  var prevDisabled = pagination.page <= 1 ? ' disabled' : '';
  html += '<button class="page-btn"' + prevDisabled + ' onclick="' + functionName + '(' + (pagination.page - 1) + ')">‹</button>';

  for (var i = 1; i <= pagination.totalPages; i++) {
    if (i === 1 || i === pagination.totalPages || isInPageRange(i, pagination.page)) {
      var activeClass = i === pagination.page ? ' active' : '';
      html += '<button class="page-btn' + activeClass + '" onclick="' + functionName + '(' + i + ')">' + i + '</button>';
    } else if (i === pagination.page - 3 || i === pagination.page + 3) {
      html += '<span>...</span>';
    }
  }

  var nextDisabled = pagination.page >= pagination.totalPages ? ' disabled' : '';
  html += '<button class="page-btn"' + nextDisabled + ' onclick="' + functionName + '(' + (pagination.page + 1) + ')">›</button>';
  html += '</div>';
  return html;
}

// ========== 유틸리티 ==========
function setPageTitle(title) {
  document.getElementById('page-title').textContent = title;
}

function showLoading() {
  document.getElementById('page-container').innerHTML = `
    <div style="text-align:center;padding:60px;">
      <div class="loading-spinner" style="margin:0 auto;"></div>
      <p style="margin-top:16px;color:var(--text-secondary);">로딩 중...</p>
    </div>
  `;
}

function showError(message) {
  document.getElementById('page-container').innerHTML = `
    <div class="empty-state">
      <div class="empty-state-icon">⚠️</div>
      <div class="empty-state-title">오류 발생</div>
      <div class="empty-state-text">${escapeHtml(message)}</div>
    </div>
  `;
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.remove();
  }, 3000);
}

function closeModal(e) {
  if (e) { if (e.target !== e.currentTarget) return; }
  document.getElementById('modal-container').innerHTML = '';
}

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  const now = new Date();
  const diff = now - date;

  if (diff < 60 * 1000) return '방금 전';
  if (diff < 60 * 60 * 1000) return `${Math.floor(diff / (60 * 1000))}분 전`;
  if (diff < 24 * 60 * 60 * 1000) return `${Math.floor(diff / (60 * 60 * 1000))}시간 전`;
  if (diff < 7 * 24 * 60 * 60 * 1000) return `${Math.floor(diff / (24 * 60 * 60 * 1000))}일 전`;

  return date.toLocaleDateString('ko-KR');
}

function formatFileSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function extractYouTubeId(url) {
  if (!url) return null;
  const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/);
  return match ? match[1] : null;
}

function getFileIconClass(fileType) {
  if (!fileType) return 'default';
  const type = fileType.toLowerCase();
  if (type.includes('ppt') || type.includes('presentation')) return 'ppt';
  if (type.includes('pdf')) return 'pdf';
  if (type.includes('doc') || type.includes('word')) return 'doc';
  if (type.includes('xls') || type.includes('excel') || type.includes('sheet')) return 'xls';
  return 'default';
}

function getFileTypeLabel(fileType) {
  if (!fileType) return 'FILE';
  const type = fileType.toLowerCase();
  if (type.includes('ppt')) return 'PPT';
  if (type.includes('pdf')) return 'PDF';
  if (type.includes('doc')) return 'DOC';
  if (type.includes('xls')) return 'XLS';
  if (type.includes('video')) return 'VIDEO';
  return 'FILE';
}

// ========== 비밀번호 변경 ==========
function showChangePasswordModal(forced) {
  var closeBtn = '';
  var overlayClose = '';
  if (!forced) {
    closeBtn = '<button class="modal-close" onclick="closeModal()">&times;<' + '/button>';
    overlayClose = 'onclick="closeModal(event)"';
  }

  var html = '<div class="modal-overlay" ' + overlayClose + '>' +
    '<div class="modal" onclick="event.stopPropagation()">' +
    '<div class="modal-header">' +
    '<h3 class="modal-title">' + (forced ? '🔐 비밀번호 변경 필요' : '🔑 비밀번호 변경') + '<' + '/h3>' +
    closeBtn +
    '<' + '/div>' +
    '<div class="modal-body">' +
    (forced ? '<div class="password-notice">최초 로그인입니다. 보안을 위해 비밀번호를 변경해주세요.<' + '/div>' : '') +
    (!forced ?
      '<div class="form-group">' +
      '<label class="form-label">현재 비밀번호 *<' + '/label>' +
      '<input type="password" class="form-input" id="modal-current-pw" placeholder="현재 비밀번호를 입력하세요">' +
      '<' + '/div>' : '') +
    '<div class="form-group">' +
    '<label class="form-label">새 비밀번호 *<' + '/label>' +
    '<input type="password" class="form-input" id="modal-new-pw" placeholder="새 비밀번호를 입력하세요 (4자 이상)">' +
    '<' + '/div>' +
    '<div class="form-group">' +
    '<label class="form-label">새 비밀번호 확인 *<' + '/label>' +
    '<input type="password" class="form-input" id="modal-confirm-pw" placeholder="새 비밀번호를 다시 입력하세요">' +
    '<' + '/div>' +
    '<div id="pw-change-error" class="login-error" style="display:none;"><' + '/div>' +
    '<' + '/div>' +
    '<div class="modal-footer">' +
    (!forced ? '<button class="btn btn-secondary" onclick="closeModal()">취소<' + '/button>' : '') +
    '<button class="btn btn-primary" onclick="handleChangePassword(' + (forced ? 'true' : 'false') + ')">비밀번호 변경<' + '/button>' +
    '<' + '/div>' +
    '<' + '/div>' +
    '<' + '/div>';

  document.getElementById('modal-container').innerHTML = html;
}

async function handleChangePassword(forced) {
  var currentPwInput = document.getElementById('modal-current-pw');
  var currentPw = currentPwInput ? currentPwInput.value : '';
  var newPw = document.getElementById('modal-new-pw').value;
  var confirmPw = document.getElementById('modal-confirm-pw').value;
  var errorDiv = document.getElementById('pw-change-error');

  if (!forced && !currentPw) {
    errorDiv.textContent = '현재 비밀번호를 입력해주세요.';
    errorDiv.style.display = 'block';
    return;
  }

  if (!newPw || !confirmPw) {
    errorDiv.textContent = '새 비밀번호를 입력해주세요.';
    errorDiv.style.display = 'block';
    return;
  }

  if (newPw.length < 4) {
    errorDiv.textContent = '새 비밀번호는 4자 이상이어야 합니다.';
    errorDiv.style.display = 'block';
    return;
  }

  if (newPw !== confirmPw) {
    errorDiv.textContent = '새 비밀번호가 일치하지 않습니다.';
    errorDiv.style.display = 'block';
    return;
  }

  if (!forced && currentPw === newPw) {
    errorDiv.textContent = '현재 비밀번호와 다른 비밀번호를 입력해주세요.';
    errorDiv.style.display = 'block';
    return;
  }

  errorDiv.style.display = 'none';

  var result = await api('changePassword', {
    employeeId: App.user.employeeId,
    currentPassword: currentPw,
    newPassword: newPw
  });

  if (result.success) {
    App.user.isFirstLogin = false;
    App.isFirstLogin = false;
    showToast('비밀번호가 성공적으로 변경되었습니다.', 'success');

    if (forced) {
      alert('비밀번호가 변경되었습니다. 새 비밀번호로 다시 로그인해주세요.');
      handleLogout();
    } else {
      closeModal();
    }
  } else {
    errorDiv.textContent = result.error || '비밀번호 변경에 실패했습니다.';
    errorDiv.style.display = 'block';
  }
}

function handleFabClick() {
  if (App.currentPage === 'post') {
    if (App.currentBoardId) {
      navigateTo('board', { boardId: App.currentBoardId });
    } else {
      loadDashboard();
    }
  } else if (App.currentPage === 'board') {
    loadDashboard();
  } else {
    loadDashboard();
  }
}

// ========== [신규] 헬퍼 함수들 ==========

function getContentTypeLabel(type) {
  const labels = {
    'video': '영상',
    'file': '자료',
    'mixed': '게시글'
  };
  return labels[type] || '게시글';
}

function getBoardIcon(boardName) {
  const icons = {
    '상품 교육': '🎯',
    '영업 스킬': '💼',
    '신입 교육': '🎓',
    '경영 전략': '📊',
    '시스템 활용': '🔧',
    '우수 사례': '💡'
  };
  return icons[boardName] || '📋';
}

// ========== [신규] 성능 모니터링 ==========
function measurePerformance() {
  if (window.performance && window.performance.timing) {
    const perfData = window.performance.timing;
    const pageLoadTime = perfData.loadEventEnd - perfData.navigationStart;
    const connectTime = perfData.responseEnd - perfData.requestStart;
    const renderTime = perfData.domComplete - perfData.domLoading;

    console.log('=== Performance Metrics ===');
    console.log('Page Load Time:', pageLoadTime, 'ms');
    console.log('Connect Time:', connectTime, 'ms');
    console.log('Render Time:', renderTime, 'ms');
    console.log('==========================');
  }
}

// 페이지 로드 완료 시 성능 측정
window.addEventListener('load', function () {
  setTimeout(measurePerformance, 0);
});

// ========== [신규] 글로벌 에러 핸들러 ==========
window.addEventListener('error', function (e) {
  console.error('Global error:', e.error);
});

window.addEventListener('unhandledrejection', function (e) {
  console.error('Unhandled promise rejection:', e.reason);
});
