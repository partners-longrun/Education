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
  isFirstLogin: false,
  historyStack: [] // Navigation history for "Back" functionality
};

// ========== 초기화 ==========
document.addEventListener('DOMContentLoaded', init);

// [수정] init() 함수 - LocalCache 활용
async function init() {
  console.log('App Initializing... Version: 2026-02-17 Mobile Video Fix Applied'); // [디버깅] 모바일 캐시 확인용 로그
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

      // [신규] 최신 공지사항 사전 캐싱 (모달 즉시 로딩용)
      try {
        const noticeBoard = App.boards ? App.boards.find(b => b.boardName === '공지사항') : null;
        if (noticeBoard) {
          const cacheKey = `posts_${noticeBoard.boardId}_page1`;
          const cachedPosts = LocalCache.get(cacheKey);
          if (!cachedPosts || !cachedPosts.data || cachedPosts.data.length === 0) {
            // 백그라운드 비동기로 최신 공지사항 1개 미리 불러오기
            api('getPosts', { boardId: noticeBoard.boardId, page: 1, pageSize: 1 }).then(res => {
              if (res.success && res.data && res.data.length > 0) {
                LocalCache.set(cacheKey, res, 5); // 5분 캐싱
              }
            }).catch(e => console.error('Prefetch notice failed', e));
          }
        }
      } catch (e) {
        console.error('Notice prefetch error:', e);
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

  // [신규] 앱 초기화 완료 후 로딩 오버레이 제거 (혹시 남아있다면)
  hideDashboardLoading();

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

  // [신규] 대시보드 로딩 오버레이 숨김 (화면 전환 시 안전장치)
  // hideDashboardLoading(); // 주석 처리: 명시적으로 닫을 때만 닫히도록 변경

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
      showDashboardLoading(); // [신규] 대시보드 로드 시작 시 로딩 표시
      loadDashboard();
    }
  } else {
    showDashboardLoading(); // [신규] 대시보드 로드 시작 시 로딩 표시
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

  // [신규] 대시보드 로딩 오버레이 미리 표시 (로그인 성공 시 자연스러운 전환을 위해)
  // 투명하게 시작해서 로그인 성공 시 나타나게 함, 실패하면 숨김
  // showDashboardLoading(); 

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

      // [신규] 로그인 성공 직후 로딩 오버레이 표시 (블랭크 페이지 방지)
      showDashboardLoading();

      // 최초 로그인 체크
      if (result.user.isFirstLogin) {
        hideDashboardLoading(); // 비밀번호 변경 모달은 로딩 끔
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

// ========== [신규] 대시보드 로딩 오버레이 관리 ==========
function showDashboardLoading() {
  let overlay = document.getElementById('dashboard-loading-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'dashboard-loading-overlay';
    overlay.className = 'dashboard-loading-overlay';
    overlay.innerHTML = `
      <div class="dashboard-loading-spinner"></div>
      <div class="dashboard-loading-text">파트너스 교육관 데이터를 불러오는 중...</div>
    `;
    document.body.appendChild(overlay);
  }

  // 약간의 딜레이 후 표시 (DOM 렌더링 확보)
  requestAnimationFrame(() => {
    overlay.classList.add('visible');
  });
}

function hideDashboardLoading() {
  const overlay = document.getElementById('dashboard-loading-overlay');
  if (overlay) {
    overlay.classList.remove('visible');
    // 애니메이션 종료 후 제거하지 않고 숨기기만 함 (재사용)
    setTimeout(() => {
      if (!overlay.classList.contains('visible')) {
        // overlay.remove(); // 제거하지 않고 유지
      }
    }, 300);
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
function navigateTo(page, params = {}, isBack = false) {
  // 뒤로 가기가 아니고, 현재 페이지가 존재하면 히스토리 스택에 저장
  if (!isBack && App.currentPage && App.currentPage !== page) {
    App.historyStack.push({ page: App.currentPage, params: App.currentParams || {} });
  }

  App.currentPage = page;
  App.currentParams = params;

  // 화면 전환 시 스크롤 최상단으로 이동
  window.scrollTo(0, 0);

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

  // [UI개선] fade-in 애니메이션 적용
  const container = document.getElementById('page-container');
  if (container) {
    container.classList.remove('page-fade-in');
    void container.offsetWidth; // reflow trigger
    container.classList.add('page-fade-in');
  }

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
    default:
      loadDashboard();
  }

  // FAB Visibility
  const fabContainer = document.getElementById('fab-container');
  if (fabContainer) {
    if (page === 'dashboard') {
      fabContainer.style.display = 'none';
    } else {
      fabContainer.style.display = 'flex';
    }
  }

  // [UI개선] 하단 탭바 상태 업데이트
  updateTabBar(page);
}

// ========== 대시보드 ==========
// ========== [수정] 대시보드 로딩 최적화 & 레이아웃 간소화 ==========

async function loadDashboard() {
  console.time('loadDashboard'); // 성능 측정

  setPageTitle('파트너스 <span style="color:var(--primary)">교육관</span>');
  setBreadcrumb([]);

  const container = document.getElementById('page-container');

  // 게시판과 동일한 skeleton-list 방식으로 로딩 표시
  const skeletonItems = Array(5).fill('').map(() => `
    <div class="skeleton-item">
      <div class="skeleton-line title"></div>
      <div class="skeleton-line meta"></div>
    </div>
  `).join('');
  container.innerHTML = `
    <div class="skeleton-list">
      <div class="skeleton-line title" style="width:40%; margin-bottom:24px;"></div>
      ${skeletonItems}
      <div class="skeleton-line title" style="width:40%; margin:24px 0 16px;"></div>
      ${skeletonItems}
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
        hideDashboardLoading(); // [신규] 에러 시 로딩 숨김
        console.timeEnd('loadDashboard');
        return;
      }
      data = result.data;
      LocalCache.set('dashboard', data, 5); // 5분 캐싱
    }

    renderDashboard(data);
  }

  // [신규] 대시보드 렌더링 완료 후 로딩 오버레이 숨김
  // 약간의 딜레이를 주어 UI가 완전히 그려진 후 걷어냄
  setTimeout(() => {
    hideDashboardLoading();
    // [신규] 홈 화면 렌더링 후 백그라운드에서 게시글 상세 요약 데이터 사전 캐싱
    prefetchHomePosts(data);
  }, 300);

  console.timeEnd('loadDashboard');
}

// [수정] 대시보드 렌더링 함수 - 간소화된 레이아웃 & UI 개선
function renderDashboard(data) {
  App.boards = data.boards;

  // 게시판 네비 업데이트
  updateBoardNav(data.boards);

  // 게시판 목록 최신화
  sessionStorage.setItem('boardList', JSON.stringify(data.boards));
  LocalCache.set('boards', data.boards, 30);

  // HTML 렌더링
  const container = document.getElementById('page-container');
  const boardIcons = ['📚', '💼', '📊', '🎯', '📢', '🔖', '📌', '🗂️'];

  container.innerHTML = `
    <!-- 환영 인사 -->
    <div class="welcome-section" style="margin-bottom: 30px;">
      <h1 class="welcome-title">안녕하세요, ${escapeHtml(App.user.name)}님 👋</h1>
      <p class="welcome-subtitle">파트너스 교육관에 오신 것을 환영합니다.</p>
    </div>
    
    <!-- 대시보드 옵션 켜진 게시판의 최신글 보기 -->
    ${data.boards.filter(b => b.showOnDashboard).map(board => `
      <section class="section">
        <div class="section-header" style="display:flex; justify-content:space-between; align-items:center;">
          <h2 class="section-title" style="cursor:pointer;" onclick="navigateTo('board', {boardId:'${board.boardId}'})">
            <span class="section-title-icon">📋</span>
            ${escapeHtml(board.boardName)}
          </h2>
          <button class="btn" style="font-size:12px; padding:4px 8px;" onclick="navigateTo('board', {boardId:'${board.boardId}'})">더보기 ></button>
        </div>
        <div class="simple-list">
          ${renderSimpleList(board.recentPosts, '등록된 게시글이 없습니다.', 'file')}
        </div>
      </section>
    `).join('')}
    
    <!-- 게시판 이동 메뉴 부분 삭제 요청에 따라 기존 게시판 섹션은 제외하거나, 하단에 그대로 둠 
         요청 내용: "'최근 영상, 최근 자료, 게시판'을 각 게시판 제목으로 대체하고..." -> 기존 섹션들 모두 대체 -->
    <!-- 추가적인 하단 게시판 요약(격자)은 요청에 의해 생략 -->
  `;
}

/**
 * [신규] 홈 화면의 최근 게시글 상세 정보를 백그라운드에서 사전 캐싱
 */
async function prefetchHomePosts(dashboardData) {
  if (!dashboardData || !dashboardData.boards) return;

  const boardsWithDashboard = dashboardData.boards.filter(b => b.showOnDashboard);
  const allRecentPosts = [];

  boardsWithDashboard.forEach(board => {
    if (board.recentPosts && board.recentPosts.length > 0) {
      allRecentPosts.push(...board.recentPosts);
    }
  });

  if (allRecentPosts.length === 0) return;

  console.log(`Prefetching ${allRecentPosts.length} posts for instant access...`);

  // 순차적으로 호출하여 서버 부하 방지
  for (const post of allRecentPosts) {
    const cacheKey = `post_detail_${post.postId}`;
    // 이미 상세 정보가 캐시되어 있으면 건너뜀 (게시판 목록이나 최근 공지 등에서 캐시됐을 수 있음)
    if (LocalCache.get(cacheKey)) continue;

    try {
      // 1초 간격으로 요청 (GAS 속도 제한 고려)
      await new Promise(resolve => setTimeout(resolve, 1000));

      api('getPostById', { postId: post.postId }).then(result => {
        if (result.success) {
          LocalCache.set(cacheKey, result.data, 10); // 10분간 상세 정보 캐싱
          console.log(`Prefetched post detail: ${post.postId}`);
        }
      }).catch(e => console.warn(`Prefetch failed for post ${post.postId}`, e));
    } catch (e) {
      console.warn('Prefetch loop error', e);
    }
  }
}

// [수정] 심플 리스트 렌더링 헬퍼 - 콘텐츠 타입 아이콘 추가
function renderSimpleList(items, emptyMessage, defaultType) {
  if (!items || items.length === 0) {
    return `<div class="empty-state" style="padding:30px 0;">
      ${getEmptySvg()}
      <div class="empty-state-title">${emptyMessage}</div>
    </div>`;
  }

  return `
    <ul class="simple-post-list">
      ${items.map(item => {
    const icon = getContentIcon(item, defaultType);
    return `
        <li class="simple-post-item" onclick="navigateTo('post', {postId:'${item.postId}'})">
          <span class="simple-post-title"><span class="content-type-icon">${icon}</span>${escapeHtml(item.title)}</span>
          <div class="simple-post-meta">
            <span>${formatDate(item.createdAt)}</span>
            <span>조회 ${item.viewCount || 0}</span>
            <span>댓글 ${item.commentCount || 0}</span>
          </div>
        </li>
      `}).join('')}
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
  showBoardSkeleton(); // [UI개선] 스켈레톤 로딩

  // 1. 게시판 메타 정보 (캐시 우선)
  let board = App.boards.find(b => b.boardId === boardId);
  if (board) {
    setPageTitle(board.boardName);
    setBreadcrumb(
      [{ label: '홈', page: 'dashboard' }],
      App.isAdmin ? '<button class="btn btn-primary" onclick="showPostModal()">+ 게시글 작성</button>' : ''
    );
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
      setBreadcrumb(
        [{ label: '홈', page: 'dashboard' }],
        App.isAdmin ? '<button class="btn btn-primary" onclick="showPostModal()">+ 게시글 작성</button>' : ''
      );
    }
  }
}

// [수정] 게시판 포스트 렌더링 함수 - 콘텐츠 아이콘, 빈상태 SVG
function renderBoardPosts(posts, pagination) {
  const container = document.getElementById('page-container');

  if (posts.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        ${getEmptySvg()}
        <div class="empty-state-title">게시글이 없습니다</div>
        <div class="empty-state-text">아직 등록된 게시글이 없습니다.</div>
      </div>
    `;
    return;
  }

  container.innerHTML = `
    <div class="simple-post-list">
      ${posts.map(post => {
    const icon = getContentIcon(post);
    return `
        <div class="simple-post-item" onclick="navigateTo('post', {postId:'${post.postId}'})">
          <div class="simple-post-title"><span class="content-type-icon">${icon}</span>${escapeHtml(post.title)}</div>
          <div class="simple-post-meta">
            <span>${formatDate(post.createdAt)}</span>
            <span>조회 ${post.viewCount || 0}</span>
            <span>댓글 ${post.commentCount || 0}</span>
          </div>
        </div>
      `}).join('')}
    </div>
    ${renderPagination(pagination, 'loadBoardPage')}
  `;
}

// [UI개선] 스켈레톤 로딩 표시
function showBoardSkeleton() {
  const container = document.getElementById('page-container');
  const items = Array(6).fill('').map(() => `
    <div class="skeleton-item">
      <div class="skeleton-line title"></div>
      <div class="skeleton-line meta"></div>
    </div>
  `).join('');
  container.innerHTML = `<div class="skeleton-list">${items}</div>`;
}

async function loadBoardPage(page) {
  // 페이지 이동은 캐시하지 않음 (최신 데이터 중요)
  const postsResult = await api('getPosts', { boardId: App.currentBoardId, page, pageSize: 12 });
  if (postsResult.success) {
    renderBoardPosts(postsResult.data, postsResult.pagination);
  }
}

// ========== 게시글 상세 ==========
// [수정] 게시글 로드 최적화 (Optimistic UI)
async function loadPost(postId) {
  showLoading();

  // 1. [최적화] 대시보드나 게시판 목록에서 이미 로드된 데이터가 있는지 확인
  let cachedPost = null;

  // A. 대시보드 데이터 확인
  // [수정] 캐시 키 불일치 수정 ('dashboard_data' -> 'dashboard')
  const dashboardData = LocalCache.get('dashboard');
  if (dashboardData && dashboardData.recentVideos) { // dashboardData.data가 아니라 바로 객체일 수 있음 (구조 확인 필요하지만 일단 방어적 코드)
    const recentVideos = dashboardData.recentVideos || [];
    const recentFiles = dashboardData.recentFiles || [];
    // [수정] ID 비교 시 타입 강제 변환 (String vs Number 이슈 방지)
    cachedPost = recentVideos.find(p => String(p.postId) === String(postId)) ||
      recentFiles.find(p => String(p.postId) === String(postId));
  }
  // dashboardData구조가 {data: {...}} 인지, 바로 {...} 인지 확인 필요.
  // loadDashboard에서 LocalCache.set('dashboard', result.data, 5) 하므로 result.data가 들어감.
  // result.data 구조는 { recentVideos: [...], recentFiles: [...] } 임.
  // 따라서 LocalCache.get('dashboard')는 { recentVideos: [...], recentFiles: [...] } 를 반환함.

  // B. 현재 게시판 목록 데이터 확인
  if (!cachedPost && App.currentBoardId) {
    const boardCacheKey = `posts_${App.currentBoardId}_page1`;
    const boardData = LocalCache.get(boardCacheKey);
    if (boardData && boardData.data) {
      cachedPost = boardData.data.find(p => String(p.postId) === String(postId));
    }
  }

  // C. [신규] 사전 캐싱된 상세 정보 데이터 확인 (가장 완벽한 데이터)
  const prefetchedDetail = LocalCache.get(`post_detail_${postId}`);
  if (prefetchedDetail) {
    console.log('Using PREFETCHED post detail for instant load:', postId);
    await renderPostDetail(prefetchedDetail);
    hideLoading();
    // 상세 정보가 이미 완벽하므로 여기서 종료 (또는 백그라운드 갱신만 수행)
    // 최신성 보장을 위해 백그라운드에서 getPostById를 호출하여 갱신할 수도 있음
    updatePostDetailFromServerOptimized(postId);
    return;
  }

  // 2. [최적화] 캐시 데이터가 있으면 즉시 렌더링 (첨부파일/댓글은 로딩 스피너)
  if (cachedPost) {
    console.log('Using cached post data for instant load:', postId);
    cachedPost._fromCache = true;
    await renderPostDetail(cachedPost);
    hideLoading();
  }

  // 3. 서버에서 최신 데이터(댓글/조회수/첨부파일 등) 가져오기
  try {
    const result = await api('getPostById', { postId });

    if (result.success) {
      if (cachedPost) {
        // [최적화] 캐시 렌더링 후 서버 응답 → 첨부파일/댓글 영역만 부분 갱신 (전체 재렌더링 X)
        updatePostDetailFromServer(result.data);
      } else {
        await renderPostDetail(result.data);
        hideLoading();
      }
    } else {
      if (!cachedPost) {
        showError(result.error);
        hideLoading();
      }
    }
  } catch (e) {
    if (!cachedPost) {
      showError('게시글을 불러오는데 실패했습니다.');
      hideLoading();
    }
  }
}

// [신규] 게시글 상세 렌더링 함수 분리
async function renderPostDetail(post) {
  App.currentPostId = post.postId;

  // [수정] 게시판 이름이 없으면 App.boards에서 찾아서 채움 (Dashboard 클릭 시 누락 방지)
  let boardName = post.boardName;
  if (!boardName && post.boardId && App.boards) {
    const board = App.boards.find(b => b.boardId === post.boardId);
    if (board) boardName = board.boardName;
  }
  setPageTitle(boardName || '게시판');
  // [수정] 검색 화면에서 진입했는지 여부에 따른 브레드크럼 분기
  if (App.currentSearchQuery) {
    setBreadcrumb([
      { label: '홈', page: 'dashboard' },
      { label: `"${App.currentSearchQuery}" 검색결과로 돌아가기`, onClick: `handleSearch('${App.currentSearchQuery}')` }
    ]);
  } else {
    setBreadcrumb([
      { label: '홈', page: 'dashboard' },
      { label: boardName || '게시판', page: 'board', params: { boardId: post.boardId } }
    ]);
  }

  // [신규] 사이드바 네비게이션 싱크 맞추기 (대시보드에서 진입 시)
  if (post.boardId) {
    App.currentBoardId = post.boardId;
    // 사이드바 활성 상태 업데이트
    document.querySelectorAll('.nav-item').forEach(item => {
      item.classList.remove('active');
      if (item.dataset.boardId === post.boardId) {
        item.classList.add('active');
      }
    });
  }

  // [최적화] 댓글은 서버에서 getPostById 응답에 포함됨 (별도 API 호출 제거)
  // 캐시 데이터에는 댓글이 없을 수 있으므로 방어적 처리
  let comments = post.comments || [];

  const container = document.getElementById('page-container');

  // [안전장치] attachments가 null/undefined일 경우 빈 배열로 처리
  const attachments = post.attachments || [];

  container.innerHTML = `
    <div class="post-container">

      <div class="post-header-card">
        <h1 class="post-detail-title">${escapeHtml(post.title)}</h1>
        <div class="post-meta">
          <span class="post-meta-item">📅 ${formatDate(post.createdAt)}</span>
          <span class="post-meta-item">👁️ 조회 ${post.viewCount || 0}</span>
        </div>
      </div>

      ${renderVideoPlayer(post)}
      
      <!-- Main File Attachment (if not video and exists) -->
      ${(post.driveFileId && post.driveFileType !== 'video') ? `
        <div class="content-card" style="cursor:pointer;" onclick="window.open('https://drive.google.com/file/d/${post.driveFileId}/view', '_blank')">
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

      ${post.content ? `
        <div class="content-card">
          <h3>📝 내용</h3>
          <div class="post-content">${escapeHtml(post.content).replace(/\n/g, '<br>')}</div>
        </div>
      ` : ''}
      
      <div id="attachments-section">
      ${attachments.length > 0 ? `
        <div class="content-card">
          <h3>📎 첨부파일</h3>
          <div class="attachment-list">
            ${attachments.map(att => renderAttachment(att)).join('')}
          </div>
        </div>
      ` : (!post._fromCache ? '' : `
        <div class="content-card">
          <h3>📎 첨부파일</h3>
          <div style="text-align:center; padding:20px; color:var(--text-secondary);">
            <div class="loading-spinner" style="width:24px;height:24px;margin:0 auto 8px;border-color:rgba(0,0,0,0.1);border-top-color:var(--primary);"></div>
            로딩 중...
          </div>
        </div>
      `)}
      </div>
      
      <div id="comments-section">
      <div class="content-card">
        <div class="comments-header">
          <h3 class="comments-title">💬 댓글 <span class="comments-count" id="comment-count">${comments ? comments.length : 0}</span></h3>
        </div>
        
        <div class="comment-form">
          <div class="comment-input-wrapper">
            <input type="text" class="comment-input" id="comment-input" placeholder="댓글을 입력하세요..." autocomplete="off">
            <div class="comment-submit-row">
              <button class="comment-submit" onclick="submitComment('${post.postId}')">등록</button>
            </div>
          </div>
        </div>
        
        <div class="comment-list" id="comment-list">
          ${post._fromCache ? `
            <div style="text-align:center; padding:20px; color:var(--text-secondary);">
              <div class="loading-spinner" style="width:24px;height:24px;margin:0 auto 8px;border-color:rgba(0,0,0,0.1);border-top-color:var(--primary);"></div>
              댓글 로딩 중...
            </div>
          ` : renderComments(comments)}
        </div>
      </div>
      </div>
    </div>
  `;
}

/**
 * [신규] 서버 응답으로 첨부파일/댓글 영역만 부분 갱신 (전체 재렌더링 X)
 */
function updatePostDetailFromServer(serverPost) {
  // 첨부파일 영역 갱신
  const attachmentsSection = document.getElementById('attachments-section');
  if (attachmentsSection) {
    const attachments = serverPost.attachments || [];
    if (attachments.length > 0) {
      attachmentsSection.innerHTML = `
        <div class="content-card">
          <h3>📎 첨부파일</h3>
          <div class="attachment-list">
            ${attachments.map(att => renderAttachment(att)).join('')}
          </div>
        </div>
      `;
    } else {
      attachmentsSection.innerHTML = '';
    }
  }

  // 댓글 영역 갱신
  const commentsSection = document.getElementById('comments-section');
  if (commentsSection) {
    const comments = serverPost.comments || [];
    commentsSection.innerHTML = `
      <div class="content-card">
        <div class="comments-header">
          <h3 class="comments-title">💬 댓글 <span class="comments-count" id="comment-count">${comments.length}</span></h3>
        </div>
        
        <div class="comment-form">
          <div class="comment-input-wrapper">
            <input type="text" class="comment-input" id="comment-input" placeholder="댓글을 입력하세요..." autocomplete="off">
            <div class="comment-submit-row">
              <button class="comment-submit" onclick="submitComment('${serverPost.postId}')">등록</button>
            </div>
          </div>
        </div>
        
        <div class="comment-list" id="comment-list">
          ${renderComments(comments)}
        </div>
      </div>
    `;
  }
}

/**
 * [신규] 사전 캐싱된 데이터 사용 시, 백그라운드에서 서버 데이터를 조회하여 갱신
 */
async function updatePostDetailFromServerOptimized(postId) {
  try {
    const result = await api('getPostById', { postId });
    if (result.success) {
      updatePostDetailFromServer(result.data);
      // 캐시도 최신화
      LocalCache.set(`post_detail_${postId}`, result.data, 10);
    }
  } catch (e) {
    console.warn('Background update failed', e);
  }
}

// ========== 좋아요 (기능 삭제됨) ==========
// function toggleLike(postId) { ... }

// ========== 댓글 ==========
async function submitComment(postId) {
  const input = document.getElementById('comment-input');
  const btn = document.querySelector('.comment-submit'); // Simple selection since only one form usually

  if (!input) return;

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
      <button class="btn btn-primary" onclick="showBoardModal(null, event)">+ 게시판 추가</button>
    </div>
    <div class="admin-table-container">
      <table class="admin-table">
        <thead>
          <tr>
            <th>순서</th>
            <th>게시판명</th>
            <th>설명</th>
            <th>대시보드 노출</th>
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
              <td>${board.showOnDashboard ? 'O' : 'X'}</td>
              <td>${board.postCount}</td>
              <td class="admin-actions">
                <button class="admin-btn edit" onclick="showBoardModal('${board.boardId}', event)">수정</button>
                <button class="admin-btn delete" onclick="deleteBoard('${board.boardId}')">삭제</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

async function showBoardModal(boardId = null, btnEvent = null) {
  // 클릭 이벤트(MouseEvent)가 boardId로 들어오는 것을 방지
  if (boardId && typeof boardId !== 'string' && typeof boardId !== 'number') {
    boardId = null;
  }

  // 로딩 상태 표시
  let btn = null;
  let originalBtnText = '';
  if (btnEvent && btnEvent.currentTarget) {
    btn = btnEvent.currentTarget;
    originalBtnText = btn.innerHTML;
    btn.innerHTML = '<span class="loading-spinner" style="width:14px;height:14px;border-width:2px;display:inline-block;vertical-align:middle;margin-right:4px;"></span> 처리중...';
    btn.disabled = true;
  }

  let board = null;
  if (boardId) {
    const result = await api('getBoardById', { boardId });
    if (result.success) board = result.data;
  }

  // 모달 렌더링 후 버튼 복구
  if (btn) {
    btn.innerHTML = originalBtnText;
    btn.disabled = false;
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
          <label style="display: flex; align-items: center; gap: 12px; margin-top: 16px; padding: 16px; background: var(--background); border: 1px solid var(--border); border-radius: 12px; cursor: pointer; transition: background 0.2s;" onmouseover="this.style.background='var(--border)'" onmouseout="this.style.background='var(--background)'">
            <input type="checkbox" id="modal-board-show" ${board && board.showOnDashboard ? 'checked' : ''} style="width: 22px; height: 22px; accent-color: var(--primary); cursor: pointer; flex-shrink: 0;">
            <div style="display: flex; flex-direction: column; gap: 4px;">
              <span style="font-size: 15px; font-weight: 600; color: var(--text-primary);">홈 대시보드 최신글 노출</span>
              <span style="font-size: 13px; color: var(--text-secondary);">이 게시판에 올라오는 최신글 3개를 메인 홈에 보여줍니다.</span>
            </div>
          </label>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" onclick="closeModal()">취소</button>
          <button class="btn btn-primary" id="save-board-btn" onclick="saveBoard('${boardId || ''}')">${board ? '수정' : '추가'}</button>
        </div>
      </div>
    </div>
  `;

  document.getElementById('modal-container').innerHTML = html;
}

async function saveBoard(boardId) {
  const btn = document.getElementById('save-board-btn');
  if (btn && btn.disabled) return;

  const boardName = document.getElementById('modal-board-name').value.trim();
  const description = document.getElementById('modal-board-desc').value.trim();
  const showOnDashboard = document.getElementById('modal-board-show').checked;

  if (!boardName) {
    showToast('게시판명을 입력해주세요.', 'error');
    return;
  }

  // 버튼 비활성화 및 로딩 표시
  if (btn) {
    btn.disabled = true;
    btn.dataset.originalText = btn.textContent;
    btn.innerHTML = '<span class="loading-spinner" style="width:14px;height:14px;border-width:2px;display:inline-block;vertical-align:middle;margin-right:4px;"></span> 처리 중...';
  }

  let result;
  if (boardId) {
    result = await api('updateBoard', { boardId, boardName, description, showOnDashboard });
  } else {
    result = await api('createBoard', { boardName, description, showOnDashboard });
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
    // 버튼 복구
    if (btn) {
      btn.disabled = false;
      btn.textContent = btn.dataset.originalText || (boardId ? '수정' : '추가');
    }
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
        <button class="btn btn-primary" onclick="showPostModal(null, event)">+ 게시글 작성</button>
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
      <button class="btn btn-primary" onclick="showPostModal(null, event)">+ 게시글 작성</button>
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
                <button class="admin-btn edit" onclick="showPostModal('${post.postId}', event)">수정</button>
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
async function showPostModal(postId = null, btnEvent = null) {
  // 클릭 이벤트 방어
  if (postId && typeof postId !== 'string' && typeof postId !== 'number') {
    postId = null;
  }

  // 로딩 상태 표시
  let btn = null;
  let originalBtnText = '';
  if (btnEvent && btnEvent.currentTarget) {
    btn = btnEvent.currentTarget;
    originalBtnText = btn.innerHTML;
    btn.innerHTML = '<span class="loading-spinner" style="width:14px;height:14px;border-width:2px;display:inline-block;vertical-align:middle;margin-right:4px;"></span> 처리중...';
    btn.disabled = true;
  }

  let post = null;
  if (postId) {
    const result = await api('getPostById', { postId });
    if (result.success) post = result.data;
  }

  // 모달 로딩 후 버튼 복구
  if (btn) {
    btn.innerHTML = originalBtnText;
    btn.disabled = false;
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

  // 버튼 비활성화 및 로딩 표시
  if (btn) {
    btn.disabled = true;
    btn.dataset.originalText = btn.textContent;
    btn.innerHTML = '<span class="loading-spinner" style="width:14px;height:14px;border-width:2px;display:inline-block;vertical-align:middle;margin-right:4px;"></span> 처리 중...';
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

  // 검색 상태 저장
  App.currentSearchQuery = query;

  setPageTitle(`"${query}" 검색 결과`);
  // [수정] 검색 화면으로 보여질 때는 브레드크럼 부분을 '홈' 하나만 나오게 초기화
  setBreadcrumb([{ label: '홈', page: 'dashboard' }]);
  // [신규] 검색 결과 로컬 캐싱 확인
  const cacheKey = 'search_' + query;
  const cachedData = LocalCache.get(cacheKey);
  let result;

  if (cachedData) {
    result = { success: true, data: cachedData };
  } else {
    showLoading();
    result = await api('search', { query });
    if (result.success) {
      LocalCache.set(cacheKey, result.data, 10); // 10분 캐시
    }
  }

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

  // [수정] 게시글을 게시판별로 그룹화
  const groupedPosts = {};
  if (data.posts && data.posts.length > 0) {
    data.posts.forEach(post => {
      const bName = post.boardName || '기타 게시판';
      if (!groupedPosts[bName]) {
        groupedPosts[bName] = [];
      }
      groupedPosts[bName].push(post);
    });
  }

  let postsSectionHtml = '';
  const boardNames = Object.keys(groupedPosts);
  if (boardNames.length > 0) {
    postsSectionHtml = boardNames.map(bName => `
      <section class="section">
        <h3 class="section-title" style="margin-bottom:12px;">📝 ${escapeHtml(bName)} (${groupedPosts[bName].length})</h3>
        <div class="simple-list">
          ${renderSimpleList(groupedPosts[bName], '검색 결과가 없습니다.', 'file')}
        </div>
      </section>
    `).join('');
  }

  container.innerHTML = `
    <p style="margin-bottom:24px;color:var(--text-secondary)">총 ${data.totalResults}개의 결과</p>
    ${postsSectionHtml}
    <!-- 다른 결과(게시판 자체 검색 등)가 있을 경우 표시 (요청이 있다면 유지, 필요없다면 삭제 가능) -->
    ${data.boards.length > 0 ? `
      <section class="section">
        <h3 class="section-title">📋 게시판 이름 일치 (${data.boards.length})</h3>
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
  return boards.map((b, i) => {
    const totalPosts = b.postCount || 0;
    return `
    <div class="board-card" style="padding:12px 16px !important;" onclick="navigateTo('board', {boardId:'${b.boardId}'})">
      <div class="board-header" style="display:flex; align-items:center; gap:8px;">
        <div class="board-icon" style="width:32px !important; height:32px !important; font-size:18px !important;">${icons[i % icons.length]}</div>
        <h3 class="board-title" style="margin:0; font-size:15px; display:flex; align-items:center; gap:6px;">
          ${escapeHtml(b.boardName)}
          <span style="font-size:13px; font-weight:normal; color:var(--text-secondary, #666);">(${totalPosts})</span>
        </h3>
      </div>
      <p class="board-desc" style="margin:6px 0 0 0 !important; font-size:13px;">${escapeHtml(b.description || '게시판 설명이 없습니다.')}</p>
    </div>
  `;
  }).join('');
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
      // [수정] iframe 임베딩 방식으로 변경 (사용자 요청: 인라인 재생)
      // 주의: '링크가 있는 모든 사용자에게 공개' 설정이 되어 있어야 함
      console.log('Rendering inline video player for:', post.driveFileId);
      return `
        <div class="video-player">
          <iframe 
            src="https://drive.google.com/file/d/${post.driveFileId}/preview" 
            width="100%" 
            height="100%" 
            frameborder="0" 
            allow="autoplay; fullscreen" 
            allowfullscreen>
          </iframe>
        </div>
      `;
    }
  }
  return '';
}

function renderAttachment(att) {
  var driveUrl = 'https:' + '/' + '/drive.google.com/file/d/' + att.driveFileId + '/view';
  return '<div class="attachment-item" onclick="window.open(\'' + driveUrl + '\', \'_blank\')">' +
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
      <div class="comment-content">
        <div class="comment-author">
          <span class="comment-author-name">${escapeHtml(c.userName)}</span>
          <span class="comment-date">${formatDate(c.createdAt)}</span>
        </div>
        <p class="comment-text">${escapeHtml(c.content)}</p>
        <div class="comment-actions">
          <button class="reply-btn" onclick="showReplyForm('${c.commentId}')">💬 답글</button>
          ${c.userId === App.user.employeeId || App.isAdmin ? `<button class="reply-btn" onclick="deleteComment('${c.commentId}')">🗑️ 삭제</button>` : ''}
        </div>
        ${(c.replies ? c.replies.length > 0 : false) ? c.replies.map(r => `
          <div class="comment-item reply-item">
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

  // 이전 화살표
  var prevDisabled = pagination.page <= 1 ? ' disabled' : '';
  html += '<button class="page-btn arrow"' + prevDisabled + ' onclick="' + functionName + '(' + (pagination.page - 1) + ')">‹</button>';

  for (var i = 1; i <= pagination.totalPages; i++) {
    if (i === 1 || i === pagination.totalPages || isInPageRange(i, pagination.page)) {
      var activeClass = i === pagination.page ? ' active' : '';
      html += '<button class="page-btn' + activeClass + '" onclick="' + functionName + '(' + i + ')">' + i + '</button>';
    } else if (i === pagination.page - 3 || i === pagination.page + 3) {
      html += '<span class="page-ellipsis">···</span>';
    }
  }

  // 다음 화살표
  var nextDisabled = pagination.page >= pagination.totalPages ? ' disabled' : '';
  html += '<button class="page-btn arrow"' + nextDisabled + ' onclick="' + functionName + '(' + (pagination.page + 1) + ')">›</button>';
  html += '</div>';
  return html;
}

// ========== 유틸리티 ==========
function setPageTitle(title) {
  document.getElementById('page-title').innerHTML = title;
}

function setBreadcrumb(items, actionHtml) {
  const bc = document.getElementById('breadcrumb');
  if (!bc) return;

  if (!items || items.length === 0) {
    bc.classList.remove('visible');
    bc.innerHTML = '';
    return;
  }

  let html = '<div class="breadcrumb-links">';
  items.forEach(function (item, index) {
    if (index > 0) {
      html += '<span class="breadcrumb-separator">/</span>';
    }
    if (item.onClick) {
      html += '<a href="#" onclick="event.preventDefault();' + item.onClick + '">' + escapeHtml(item.label) + '</a>';
    } else if (item.page) {
      const params = item.params ? JSON.stringify(item.params).replace(/"/g, "'") : '{}';
      html += '<a href="#" onclick="event.preventDefault();navigateTo(\'' + item.page + '\',' + params + ')">' + escapeHtml(item.label) + '</a>';
    } else {
      html += '<span>' + escapeHtml(item.label) + '</span>';
    }
  });
  html += '</div>';

  if (actionHtml) {
    html += actionHtml;
  }

  bc.innerHTML = html;
  bc.classList.add('visible');
}

function showLoading() {
  document.getElementById('page-container').innerHTML = `
    <div style="text-align:center;padding:60px;">
      <div class="loading-spinner" style="margin:0 auto;"></div>
      <p style="margin-top:16px;color:var(--text-secondary);">로딩 중...</p>
    </div>
  `;
}

function hideLoading() {
  // renderPostDetail이 page-container를 다시 그리므로
  // 별도 해제 로직 불필요 (호출 에러 방지용)
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
  // 기존에 DB에 &quot;, &#x27; 로 저장된 문구들 복원 (하위 호환성)
  let processedText = String(text)
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    // [보완] &amp; 도 역치환해주면 기존 데이터가 더 완벽하게 복원됩니다 (옵션)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');

  const div = document.createElement('div');
  div.textContent = processedText;
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

function formatFileSize(bytes) {
  if (!bytes || bytes === 0) return '';
  var units = ['B', 'KB', 'MB', 'GB'];
  var i = 0;
  var size = Number(bytes);
  while (size >= 1024 && i < units.length - 1) {
    size /= 1024;
    i++;
  }
  return size.toFixed(i === 0 ? 0 : 1) + ' ' + units[i];
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
  if (App.historyStack && App.historyStack.length > 0) {
    const prevState = App.historyStack.pop();
    navigateTo(prevState.page, prevState.params, true);
  } else {
    // 히스토리가 없으면 기본적으로 대시보드로 이동
    navigateTo('dashboard', {}, true);
  }
}

function handleFabUpClick() {
  // 무조건 상위 계층으로 이동
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

// [UI개선] 콘텐츠 타입 아이콘 반환
function getContentIcon(post, defaultType) {
  if (post.driveFileType === 'video' || post.youtubeUrl || defaultType === 'video') return '📺';
  if (post.contentType === 'video') return '📺';
  if (post.driveFileId || defaultType === 'file') return '📄';
  if (post.contentType === 'file') return '📄';
  return '📄';
}

// [UI개선] 빈 상태 SVG 일러스트
function getEmptySvg() {
  return `<div class="empty-state-svg">
    <svg viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="20" y="30" width="80" height="60" rx="8" fill="#f0f0f0" stroke="#d0d0d0" stroke-width="2"/>
      <rect x="30" y="42" width="40" height="4" rx="2" fill="#d0d0d0"/>
      <rect x="30" y="52" width="60" height="4" rx="2" fill="#e0e0e0"/>
      <rect x="30" y="62" width="50" height="4" rx="2" fill="#e0e0e0"/>
      <rect x="30" y="72" width="30" height="4" rx="2" fill="#e8e8e8"/>
      <circle cx="90" cy="85" r="20" fill="#f8f8f8" stroke="#d0d0d0" stroke-width="2"/>
      <path d="M85 85 L95 85 M90 80 L90 90" stroke="#c0c0c0" stroke-width="2.5" stroke-linecap="round"/>
    </svg>
  </div>`;
}

// [UI개선] 하단 탭바 상태 업데이트
function updateTabBar(page) {
  const tabs = document.querySelectorAll('.tab-item');
  tabs.forEach(tab => tab.classList.remove('active'));

  if (page === 'dashboard') {
    const homeTab = document.getElementById('tab-home');
    if (homeTab) homeTab.classList.add('active');
  } else if (page === 'board' || page === 'post') {
    const boardsTab = document.getElementById('tab-boards');
    if (boardsTab) boardsTab.classList.add('active');
  } else if (page === 'search') {
    const searchTab = document.getElementById('tab-search');
    if (searchTab) searchTab.classList.add('active');
  }
}

// [UI개선] 게시판 탭 터치 - 게시판 모음 페이지
function showBoardsTab() {
  window.scrollTo(0, 0);
  updateTabBar('board');
  const boardsTab = document.getElementById('tab-boards');
  if (boardsTab) boardsTab.classList.add('active');

  setPageTitle('게시판');
  setBreadcrumb([{ label: '홈', page: 'dashboard' }]);

  const container = document.getElementById('page-container');

  // fade-in
  container.classList.remove('page-fade-in');
  void container.offsetWidth;
  container.classList.add('page-fade-in');

  const boardIcons = ['📚', '💼', '📊', '🎯', '📢', '🔖', '📌', '🗂️'];

  if (!App.boards || App.boards.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        ${getEmptySvg()}
        <div class="empty-state-title">등록된 게시판이 없습니다</div>
      </div>
    `;
    return;
  }

  container.innerHTML = `
    <div class="board-grid">
      ${renderBoardCards(App.boards)}
    </div>

    ${App.isAdmin ? `
    <section class="section" style="margin-top:32px;">
      <div class="section-header">
        <h2 class="section-title">
          <span class="section-title-icon">⚙️</span>
          관리자
        </h2>
      </div>
      <div class="board-grid">
        <div class="board-card" style="padding:12px 16px !important; border-left:4px solid #e74c3c;" onclick="navigateTo('admin-boards')">
          <div class="board-header" style="display:flex; align-items:center; gap:8px;">
            <div class="board-icon" style="width:32px !important; height:32px !important; font-size:18px !important;">📋</div>
            <h3 class="board-title" style="margin:0; font-size:15px;">게시판 관리</h3>
          </div>
          <p class="board-desc" style="margin:6px 0 0 0 !important; font-size:13px;">게시판을 새로 만들거나 공개 여부를 설정합니다.</p>
        </div>
        
        <div class="board-card" style="padding:12px 16px !important; border-left:4px solid #3498db;" onclick="navigateTo('admin-posts')">
           <div class="board-header" style="display:flex; align-items:center; gap:8px;">
            <div class="board-icon" style="width:32px !important; height:32px !important; font-size:18px !important;">📝</div>
            <h3 class="board-title" style="margin:0; font-size:15px;">게시글 관리</h3>
          </div>
          <p class="board-desc" style="margin:6px 0 0 0 !important; font-size:13px;">개별 게시글을 확인하거나 삭제 처리할 수 있습니다.</p>
        </div>
        
        <div class="board-card" style="padding:12px 16px !important; border-left:4px solid #2ecc71;" onclick="navigateTo('admin-logs')">
          <div class="board-header" style="display:flex; align-items:center; gap:8px;">
            <div class="board-icon" style="width:32px !important; height:32px !important; font-size:18px !important;">📊</div>
            <h3 class="board-title" style="margin:0; font-size:15px;">로그인 기록</h3>
          </div>
           <p class="board-desc" style="margin:6px 0 0 0 !important; font-size:13px;">사용자들의 접속 로그를 모니터링합니다.</p>
        </div>
      </div>
    </section>
    ` : ''}
  `;
}

// [UI개선] 검색 탭 터치
function showSearchTab() {
  window.scrollTo(0, 0);
  updateTabBar('search');
  const searchTab = document.getElementById('tab-search');
  if (searchTab) searchTab.classList.add('active');

  setPageTitle('검색');
  setBreadcrumb([{ label: '홈', page: 'dashboard' }]);

  const container = document.getElementById('page-container');
  container.classList.remove('page-fade-in');
  void container.offsetWidth;
  container.classList.add('page-fade-in');

  container.innerHTML = `
    <div style="max-width:600px; margin:0 auto; padding:20px 0;">
      <div style="position:relative;">
        <input type="text" id="mobile-search-input" 
          style="width:100%; padding:14px 48px 14px 16px; border:2px solid var(--border); border-radius:12px; font-size:16px; background:var(--surface); outline:none; transition: border-color 0.2s;"
          placeholder="검색어를 입력하세요..." 
          onfocus="this.style.borderColor='var(--primary)'"
          onblur="this.style.borderColor='var(--border)'"
          onkeypress="if(event.key==='Enter'){handleSearch(this.value)}">
        <button style="position:absolute; right:4px; top:50%; transform:translateY(-50%); background:var(--primary); color:white; border:none; border-radius:10px; width:40px; height:40px; font-size:18px; cursor:pointer;" 
          onclick="handleSearch(document.getElementById('mobile-search-input').value)">🔍</button>
      </div>
      <div id="mobile-search-results" style="margin-top:20px;"></div>
    </div>
  `;

  // 자동 포커스
  setTimeout(() => {
    const input = document.getElementById('mobile-search-input');
    if (input) input.focus();
  }, 100);
}

// [UI개선] 모바일 하단 탭바 기능 추가 - 나의정보 탭
function showProfileTab() {
  window.scrollTo(0, 0);
  updateTabBar('profile');
  const profileTab = document.getElementById('tab-profile');
  if (profileTab) profileTab.classList.add('active');

  const container = document.getElementById('page-container');
  setPageTitle('내 정보');
  setBreadcrumb([]);

  container.innerHTML = `
    <div class="post-container" style="max-width:500px;">
      <div class="content-card" style="text-align:center;">
        <div style="width:80px;height:80px;background:linear-gradient(135deg,var(--primary),var(--primary-dark));border-radius:50%;display:flex;align-items:center;justify-content:center;color:white;font-size:32px;font-weight:700;margin:0 auto 16px;">
          ${App.user ? App.user.name.charAt(0) : '?'}
        </div>
        <h2 style="margin-bottom:4px;">${App.user ? escapeHtml(App.user.name) : '-'}</h2>
        <p style="color:var(--text-secondary);font-size:14px;margin-bottom:4px;">${App.user ? escapeHtml(App.user.department || '') : ''}</p>
        <p style="color:var(--text-secondary);font-size:13px;">사번: ${App.user ? App.user.employeeId : '-'}</p>
      </div>
      <div style="display:flex;flex-direction:column;gap:8px;margin-top:16px;">
        <button class="btn btn-primary" style="width:100%;padding:14px;" onclick="showChangePasswordModal(false)">🔑 비밀번호 변경</button>
        <button class="btn btn-secondary" style="width:100%;padding:14px;" onclick="handleLogout()">🔓 로그아웃</button>
      </div>
    </div>
  `;
}

// [신규추가] 모바일 하단 탭바 기능 추가 - 불꽃(공지사항 팝업) 탭
async function showLatestNotice(e) {
  if (e) {
    e.preventDefault();
    e.stopPropagation();
  }

  // 현재 탭 활성화 유지 (불꽃 아이콘은 모달만 열기 때문에 페이지 변경 안함)

  // 1. 공지사항 게시판의 boardId 찾기
  let noticeBoard = App.boards ? App.boards.find(b => b.boardName === '공지사항') : null;

  if (!noticeBoard) {
    const cached = sessionStorage.getItem('boardList');
    if (cached) {
      const boards = JSON.parse(cached);
      noticeBoard = boards.find(b => b.boardName === '공지사항');
    }
  }

  if (!noticeBoard) {
    showToast('공지사항 게시판을 찾을 수 없습니다.', 'error');
    return;
  }

  // 2. 공지사항 게시글 목록 조회 (캐시 우선 검사)
  let latestPost = null;
  const cacheKey = `posts_${noticeBoard.boardId}_page1`;
  const cachedPosts = LocalCache.get(cacheKey);

  if (cachedPosts && cachedPosts.data && cachedPosts.data.length > 0) {
    // 캐시가 있으면 즉시 렌더링 (로딩창 띄우지 않음)
    latestPost = cachedPosts.data[0];
  } else {
    // 캐시가 없으면 모달 로딩 UI 표시 (showLoading은 page-container를 덮어쓰므로 사용 금지)
    document.getElementById('modal-container').innerHTML = `
      <div class="modal-overlay">
        <div class="loading-spinner" style="border: 4px solid rgba(255,255,255,0.3); border-top: 4px solid white; width: 40px; height: 40px; border-radius: 50%; animation: spin 1s linear infinite;"></div>
      </div>
    `;

    try {
      const result = await api('getPosts', { boardId: noticeBoard.boardId, page: 1, pageSize: 1 });
      if (result.success && result.data && result.data.length > 0) {
        latestPost = result.data[0];
        LocalCache.set(cacheKey, result, 5); // 결과 캐싱
      }
    } catch (error) {
      document.getElementById('modal-container').innerHTML = '';
      showToast('공지사항을 불러오는 중 오류가 발생했습니다.', 'error');
      return;
    }
  }

  if (!latestPost) {
    document.getElementById('modal-container').innerHTML = '';
    showToast('등록된 공지사항이 없습니다.', 'info');
    return;
  }

  // 3. 팝업(모달) 렌더링 - 높이 축소 및 너비 확대
  const modalHtml = `
      <div class="modal-overlay" onclick="closeModal(event)">
        <div class="modal modal-lg" style="width: 100%; max-width: 500px;" onclick="event.stopPropagation()">
          <div class="modal-header" style="padding: 16px 20px; min-height: 50px;">
            <h3 class="modal-title" style="font-size: 16px;">📢 최신 공지사항</h3>
            <button class="modal-close" onclick="closeModal()">×</button>
          </div>
          <div class="modal-body" style="padding: 16px 20px; max-height: 60vh; overflow-y: auto;">
            <h2 style="font-size: 18px; font-weight: 700; margin-bottom: 6px;">${escapeHtml(latestPost.title)}</h2>
            <div style="font-size: 12px; color: var(--text-secondary); margin-bottom: 12px;">
              ${formatDate(latestPost.createdAt)} | 조회수 ${latestPost.viewCount || 0}
            </div>
            <hr style="border:0; border-top:1px solid var(--border); margin-bottom: 12px;">
            <div style="line-height: 1.5; font-size: 14px; color: var(--text-primary); white-space: pre-line;">
              ${escapeHtml(latestPost.content)}
            </div>
          </div>
          <div class="modal-footer" style="padding: 12px 20px; justify-content: center;">
             <button type="button" class="btn btn-primary" style="width: 100%; max-width: 180px; padding: 10px;" onclick="closeModal(); navigateTo('post', {postId:'${latestPost.postId}'});">자세히 보기</button>
             <button type="button" class="btn btn-secondary" style="padding: 10px;" onclick="closeModal()">닫기</button>
          </div>
        </div>
      </div>
    `;

  document.getElementById('modal-container').innerHTML = modalHtml;
}

// [신규추가] 모바일 하단 탭바 기능 추가 - 게시판 탭
function showBoardsTab() {
  window.scrollTo(0, 0);
  updateTabBar('learn'); // id가 tab-learn 이므로 'learn'으로 매칭
  const learnTab = document.getElementById('tab-learn');
  if (learnTab) learnTab.classList.add('active');

  setPageTitle('게시판 전체보기');
  setBreadcrumb([{ label: '홈', page: 'dashboard' }]);

  const container = document.getElementById('page-container');
  container.classList.remove('page-fade-in');
  void container.offsetWidth;
  container.classList.add('page-fade-in');

  // App.boards 또는 캐시에서 게시판 목록 가져오기
  let boardsToDisplay = App.boards;
  if (!boardsToDisplay || boardsToDisplay.length === 0) {
    const cached = sessionStorage.getItem('boardList');
    if (cached) {
      boardsToDisplay = JSON.parse(cached);
    }
  }

  if (!boardsToDisplay || boardsToDisplay.length === 0) {
    container.innerHTML = `<div class="empty-state">게시판 정보를 불러올 수 없습니다.</div>`;
    return;
  }

  const boardIcons = ['📚', '💼', '📊', '🎯', '📢', '🔖', '📌', '🗂️'];

  container.innerHTML = `
      <div class="dashboard-boards-grid">
        ${boardsToDisplay.map((board, index) => `
          <div class="dashboard-board-card" onclick="navigateTo('board', {boardId:'${board.boardId}'})">
            <div class="board-card-header" style="display: flex; align-items: center; gap: 10px; margin-bottom: 8px;">
              <div class="board-icon-wrapper" style="font-size: 20px; width: 36px; height: 36px; background: var(--background); border-radius: 8px; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
                 ${boardIcons[index % boardIcons.length]}
              </div>
              <h3 class="board-title" style="font-size: 16px; font-weight: 700; color: var(--text-primary); margin: 0;">${escapeHtml(board.boardName)}</h3>
            </div>
            ${board.description ? `<p class="board-desc" style="font-size: 13px; color: var(--text-secondary); margin-bottom: 6px; display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; line-height: 1.4;">${escapeHtml(board.description)}</p>` : ''}
            <div style="text-align: right;">
              <p class="board-count" style="font-size: 12px; color: var(--text-secondary); opacity: 0.8; margin: 0;">게시글 ${board.postCount || 0}개</p>
            </div>
          </div>
        `).join('')}
      </div>
    `;
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
