/* IRON FRONT account authentication
   Uses Supabase Auth. Passwords are sent directly to the auth provider over HTTPS;
   this game does not write passwords to localStorage or its own database.
*/
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const config = window.IRON_FRONT_AUTH_CONFIG || {};
  let client = null;
  let busy = false;
  let passwordRecoveryFlow = false;
  const MINIMUM_AGE = 13;

  function setStatus(message, isError) {
    const node = $('loginStatus');
    if (!node) return;
    node.textContent = message;
    node.classList.toggle('error', !!isError);
  }

  function setBusy(value) {
    busy = value;
    ['loginSubmit', 'signupSubmit'].forEach((id) => {
      const button = $(id);
      if (button) button.disabled = value;
    });
  }

  function switchForm(mode) {
    const forms = {
      login: 'authLoginForm',
      signup: 'authSignupForm',
      reset: 'authResetForm',
      update: 'authUpdatePasswordForm'
    };
    Object.keys(forms).forEach((key) => {
      $(forms[key]).classList.toggle('hidden', key !== mode);
    });
    $('authLoginTab').classList.toggle('selected', mode === 'login');
    $('authSignupTab').classList.toggle('selected', mode === 'signup');
    $('authLoginTab').setAttribute('aria-selected', mode === 'login' ? 'true' : 'false');
    $('authSignupTab').setAttribute('aria-selected', mode === 'signup' ? 'true' : 'false');

    const headings = {
      login: ['SIGN IN', 'Enter your account details to continue.'],
      signup: ['CREATE ACCOUNT', 'Create a player identity to access the game.'],
      reset: ['RESET PASSWORD', 'Request a secure password reset email.'],
      update: ['NEW PASSWORD', 'Choose a new password for your account.']
    };
    $('authHeading').textContent = headings[mode][0];
    $('authSubheading').textContent = headings[mode][1];
  }

  function fillBirthOptions() {
    const monthNames = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
    ];
    monthNames.forEach((month, index) => {
      const option = document.createElement('option');
      option.value = String(index + 1);
      option.textContent = month;
      $('birthMonth').appendChild(option);
    });

    const currentYear = new Date().getFullYear();
    for (let year = currentYear; year >= 1900; year -= 1) {
      const option = document.createElement('option');
      option.value = String(year);
      option.textContent = String(year);
      $('birthYear').appendChild(option);
    }
  }

  function passesMinimumAge(monthValue, yearValue) {
    const month = Number(monthValue);
    const year = Number(yearValue);
    const now = new Date();
    if (!month || !year || month < 1 || month > 12 || year > now.getFullYear()) return false;
    let age = now.getFullYear() - year;
    if (month > now.getMonth() + 1) age -= 1;
    return age >= MINIMUM_AGE;
  }

  function setAuthenticatedUser(user) {
    window.ironFrontAuthUser = user || null;
    window.ironFrontLoginComplete = !!user;

    if (typeof window.ironFrontUpdatePlayerBadge === 'function') {
      window.ironFrontUpdatePlayerBadge();
    } else if ($('playerLabel')) {
      const playerName = user && user.user_metadata && user.user_metadata.player_name;
      $('playerLabel').textContent = playerName || (user && user.email ? user.email.split('@')[0] : 'GUEST');
    }

    if (user) {
      setStatus(user.offline
        ? 'OFFLINE PROFILE READY — ONLINE ACCOUNT SERVICE IS NOT CONNECTED.'
        : 'ACCOUNT VERIFIED — ACCESS GRANTED.', false);
      if (typeof window.ironFrontSetScreen === 'function') {
        window.ironFrontSetScreen('menu');
      }
    } else if (typeof window.ironFrontSetScreen === 'function') {
      window.ironFrontSetScreen('login');
    }
  }

  function niceError(error) {
    const message = error && error.message ? error.message : 'Something went wrong. Please try again.';
    if (/invalid login credentials/i.test(message)) return 'EMAIL OR PASSWORD NOT RECOGNIZED.';
    if (/email not confirmed/i.test(message)) return 'PLEASE CONFIRM YOUR EMAIL BEFORE SIGNING IN.';
    if (/password should be at least/i.test(message)) return 'PASSWORD DOES NOT MEET THE MINIMUM LENGTH.';
    if (/user already registered/i.test(message)) return 'AN ACCOUNT MAY ALREADY EXIST. TRY SIGNING IN.';
    return message.toUpperCase();
  }

  function requireClient() {
    if (client) return true;
    setStatus('ONLINE SIGN-IN IS UNAVAILABLE. CREATE AN OFFLINE PROFILE TO PLAY ON THIS DEVICE.', false);
    return false;
  }

  async function signIn(event) {
    event.preventDefault();
    if (busy || !requireClient()) return;
    const email = $('loginEmail').value.trim();
    const password = $('loginPassword').value;
    if (!email || !password) {
      setStatus('ENTER YOUR EMAIL AND PASSWORD.', true);
      return;
    }
    setBusy(true);
    setStatus('VERIFYING ACCOUNT…', false);
    try {
      const result = await client.auth.signInWithPassword({ email, password });
      if (result.error) throw result.error;
      if (!result.data || !result.data.session || !result.data.user) {
        setStatus('SIGN IN DID NOT RETURN A VALID SESSION. TRY AGAIN.', true);
        return;
      }
      setAuthenticatedUser(result.data.user);
      $('authLoginForm').reset();
    } catch (error) {
      setStatus(niceError(error), true);
    } finally {
      setBusy(false);
    }
  }

  async function signUp(event) {
    event.preventDefault();
    if (busy) return;
    const name = $('signupName').value.trim().replace(/\s+/g, ' ');
    const email = $('signupEmail').value.trim();
    const password = $('signupPassword').value;
    const confirm = $('signupConfirm').value;

    if (name.length < 3 || name.length > 20) {
      setStatus('PLAYER NAME MUST HAVE 3 TO 20 CHARACTERS.', true);
      return;
    }

    if (!client) {
      if (!passesMinimumAge($('birthMonth').value, $('birthYear').value)) {
        setStatus('CHECK THE BIRTH MONTH AND YEAR.', true);
        return;
      }
      setBusy(true);
      setStatus('CREATING OFFLINE PLAYER PROFILE…', false);
      try {
        try { localStorage.setItem('ironfront-offline-player-v1', name); } catch (storageError) {}
        $('authSignupForm').reset();
        const guest = {
          id: 'offline-' + name.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 16),
          user_metadata: { player_name: name },
          offline: true
        };
        setAuthenticatedUser(guest);
      } finally {
        setBusy(false);
      }
      return;
    }

    if (password.length < 8) {
      setStatus('USE A PASSWORD WITH AT LEAST 8 CHARACTERS.', true);
      return;
    }
    if (password !== confirm) {
      setStatus('THE PASSWORDS DO NOT MATCH.', true);
      return;
    }
    if (!passesMinimumAge($('birthMonth').value, $('birthYear').value)) {
      setStatus('CHECK THE BIRTH MONTH AND YEAR. THIS GAME REQUIRES THE MINIMUM AGE.', true);
      return;
    }

    setBusy(true);
    setStatus('CREATING ACCOUNT…', false);
    try {
      const result = await client.auth.signUp({
        email,
        password,
        options: {
          data: { player_name: name },
          emailRedirectTo: window.location.origin + window.location.pathname
        }
      });
      if (result.error) throw result.error;

      $('authSignupForm').reset();
      if (result.data && result.data.session && result.data.user) {
        setAuthenticatedUser(result.data.user);
      } else {
        switchForm('login');
        $('loginEmail').value = email;
        setStatus('ACCOUNT CREATED. CHECK YOUR EMAIL AND CONFIRM IT BEFORE SIGNING IN.', false);
      }
    } catch (error) {
      setStatus(niceError(error), true);
    } finally {
      setBusy(false);
    }
  }

  async function requestPasswordReset(event) {
    event.preventDefault();
    if (busy || !requireClient()) return;
    const email = $('resetEmail').value.trim();
    if (!email) {
      setStatus('ENTER THE EMAIL CONNECTED TO YOUR ACCOUNT.', true);
      return;
    }
    setBusy(true);
    setStatus('SENDING PASSWORD RESET REQUEST…', false);
    try {
      const result = await client.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin + window.location.pathname
      });
      if (result.error) throw result.error;
      setStatus('IF THE EMAIL IS REGISTERED, A PASSWORD RESET LINK WILL ARRIVE SOON.', false);
      switchForm('login');
    } catch (error) {
      setStatus(niceError(error), true);
    } finally {
      setBusy(false);
    }
  }

  async function updatePassword(event) {
    event.preventDefault();
    if (busy || !requireClient()) return;
    const password = $('newPassword').value;
    const confirm = $('newPasswordConfirm').value;
    if (password.length < 8 || password !== confirm) {
      setStatus('PASSWORDS MUST MATCH AND HAVE AT LEAST 8 CHARACTERS.', true);
      return;
    }
    setBusy(true);
    setStatus('UPDATING PASSWORD…', false);
    try {
      const result = await client.auth.updateUser({ password });
      if (result.error) throw result.error;
      $('authUpdatePasswordForm').reset();
      setAuthenticatedUser(result.data.user);
      setStatus('PASSWORD UPDATED. YOU ARE SIGNED IN.', false);
    } catch (error) {
      setStatus(niceError(error), true);
    } finally {
      setBusy(false);
    }
  }

  window.ironFrontSignOut = async function () {
    if (!client) {
      try { localStorage.removeItem('ironfront-offline-player-v1'); } catch (e) {}
      setAuthenticatedUser(null);
      switchForm('signup');
      setStatus('OFFLINE PROFILE SIGNED OUT.', false);
      return;
    }
    const result = await client.auth.signOut();
    if (result.error) {
      setStatus(niceError(result.error), true);
      return;
    }
    setAuthenticatedUser(null);
    switchForm('login');
    setStatus('SIGNED OUT. SIGN IN TO ACCESS THE GAME.', false);
  };

  $('guestAccessForm').addEventListener('submit', (event) => {
    event.preventDefault();
    const name = $('guestPlayerName').value.trim().replace(/\\s+/g, ' ');
    if (name.length < 3 || name.length > 20) {
      setStatus('PLAYER NAME MUST HAVE 3 TO 20 CHARACTERS.', true);
      return;
    }
    try { localStorage.setItem('ironfront-offline-player-v1', name); } catch (e) {}
    const guest = { id: 'offline-' + name.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 16), user_metadata: { player_name: name }, offline: true };
    setAuthenticatedUser(guest);
    setStatus('OFFLINE GUEST MODE — ONLINE ACCOUNT NOT CONNECTED.', false);
  });

  $('authLoginTab').addEventListener('click', () => {
    switchForm('login');
    setStatus('SIGN IN WITH YOUR VERIFIED PLAYER ACCOUNT.', false);
  });
  $('authSignupTab').addEventListener('click', () => {
    switchForm('signup');
    setStatus('CREATE AN ACCOUNT TO UNLOCK THE GAME.', false);
  });
  $('forgotPassword').addEventListener('click', () => {
    $('resetEmail').value = $('loginEmail').value.trim();
    switchForm('reset');
    setStatus('ENTER YOUR ACCOUNT EMAIL TO REQUEST A RESET LINK.', false);
  });
  $('backToLogin').addEventListener('click', () => {
    switchForm('login');
    setStatus('SIGN IN WITH YOUR ACCOUNT.', false);
  });
  $('authLoginForm').addEventListener('submit', signIn);
  $('authSignupForm').addEventListener('submit', signUp);
  $('authResetForm').addEventListener('submit', requestPasswordReset);
  $('authUpdatePasswordForm').addEventListener('submit', updatePassword);

  fillBirthOptions();
  switchForm('signup');
  window.ironFrontLoginComplete = false;
  if (typeof window.ironFrontSetScreen === 'function') window.ironFrontSetScreen('login');

  const validUrl = typeof config.url === 'string' && /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(config.url.trim());
  const validKey = typeof config.publishableKey === 'string' &&
    config.publishableKey.trim().length > 20 &&
    !/YOUR_|PLACEHOLDER/i.test(config.publishableKey);
  if (!validUrl || !validKey) {
    // Use a clearly labeled, device-local profile when no online auth provider is configured.
    const emailLabel = document.querySelector('label[for="signupEmail"]');
    if (emailLabel) emailLabel.classList.add('hidden');
    $('signupEmail').classList.add('hidden');
    $('signupEmail').required = false;
    const passwordRow = $('signupPassword').parentElement.parentElement;
    if (passwordRow) passwordRow.classList.add('hidden');
    $('signupPassword').required = false;
    $('signupConfirm').required = false;
    $('signupSubmit').innerHTML = 'CREATE OFFLINE PLAYER PROFILE <span>→</span>';
    $('authSubheading').textContent = 'Create a profile saved only on this device. Online accounts are not connected yet.';
    $('guestAccessForm').classList.add('hidden');
    const savedName = (() => { try { return localStorage.getItem('ironfront-offline-player-v1') || ''; } catch (e) { return ''; } })();
    if (savedName) {
      const returningPlayer = {
        id: 'offline-' + savedName.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 16),
        user_metadata: { player_name: savedName },
        offline: true
      };
      setAuthenticatedUser(returningPlayer);
    } else {
      setStatus('CREATE AN OFFLINE PLAYER PROFILE BELOW TO ENTER THE GAME.', false);
    }
    return;
  }
  if (!window.supabase || typeof window.supabase.createClient !== 'function') {
    setStatus('ACCOUNT LIBRARY COULD NOT LOAD. CHECK YOUR INTERNET CONNECTION AND REFRESH.', true);
    return;
  }

  try {
    client = window.supabase.createClient(config.url.trim(), config.publishableKey.trim(), {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true
      }
    });
    client.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') {
        passwordRecoveryFlow = true;
        window.ironFrontLoginComplete = false;
        if (typeof window.ironFrontSetScreen === 'function') window.ironFrontSetScreen('login');
        switchForm('update');
        setStatus('RESET LINK VERIFIED. CHOOSE A NEW PASSWORD.', false);
        return;
      }
      if (event === 'SIGNED_OUT') {
        setAuthenticatedUser(null);
        return;
      }
      if (session && session.user && !passwordRecoveryFlow) setAuthenticatedUser(session.user);
    });
    client.auth.getSession().then(({ data, error }) => {
      if (passwordRecoveryFlow) return;
      if (error) {
        setStatus('COULD NOT RESTORE YOUR ACCOUNT SESSION. SIGN IN AGAIN.', true);
        setAuthenticatedUser(null);
        return;
      }
      if (data && data.session && data.session.user) setAuthenticatedUser(data.session.user);
      else setAuthenticatedUser(null);
    }).catch(() => {
      setAuthenticatedUser(null);
      setStatus('COULD NOT CHECK YOUR ACCOUNT SESSION. REFRESH AND TRY AGAIN.', true);
    });
  } catch (error) {
    client = null;
    setStatus('ACCOUNT SERVICE COULD NOT START. CHECK auth-config.js.', true);
  }
})();
