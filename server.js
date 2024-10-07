// server.js

require('dotenv').config(); // dotenv 패키지로 환경 변수 로드

const express = require('express');
const https = require('https');
const fs = require('fs');
const path = require('path');
const oracledb = require('oracledb');
const bodyParser = require('body-parser');
const session = require('express-session');
const axios = require('axios');

const app = express();
const PORT = 5500;

// SSL 인증서 로드
const sslOptions = {
  key: fs.readFileSync(path.join(__dirname, 'ssl', 'server.key')),
  cert: fs.readFileSync(path.join(__dirname, 'ssl', 'server.crt')),
};

// 세션 설정
app.use(
  session({
    secret: process.env.SESSION_SECRET, // 환경 변수에서 가져오기
    resave: false,
    saveUninitialized: true,
  })
);

// 바디 파서 설정
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Oracle DB 연결 정보
const dbConfig = {
  user: process.env.DB_USER, // 환경 변수에서 가져오기
  password: process.env.DB_PASSWORD, // 환경 변수에서 가져오기
  connectString: 'localhost:1521/XE', // 필요에 따라 수정
};

// Oracle DB 연결 테스트
(async function testConnection() {
  let connection;
  try {
    connection = await oracledb.getConnection(dbConfig);
    console.log('Oracle DB에 성공적으로 연결되었습니다.');
  } catch (err) {
    console.error('Oracle DB 연결 에러:', err);
  } finally {
    if (connection) {
      try {
        await connection.close();
      } catch (err) {
        console.error('연결 종료 에러:', err);
      }
    }
  }
})();

// Spotify API 설정
const clientId = process.env.CLIENT_ID; // 환경 변수에서 가져오기
const clientSecret = process.env.CLIENT_SECRET; // 환경 변수에서 가져오기
const redirectUri = process.env.REDIRECT_URI; // 환경 변수에서 가져오기

// 서버 측 로그인 여부 확인 API
app.get('/api/check-login', (req, res) => {
  if (req.session.loggedIn) {
    res.json({ loggedIn: true, username: req.session.username });
  } else {
    res.json({ loggedIn: false });
  }
});

// 사용자 로그인 API
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;

  let connection;

  try {
    connection = await oracledb.getConnection(dbConfig);

    const result = await connection.execute(
      `SELECT * FROM user_info WHERE user_id = :username AND user_password = :password`,
      [username, password],
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    if (result.rows.length > 0) {
      req.session.loggedIn = true;
      req.session.username = username;
      res.json({ success: true });
    } else {
      res.json({ success: false, message: '아이디 또는 비밀번호가 올바르지 않습니다.' });
    }
  } catch (err) {
    console.error('로그인 에러:', err);
    res.status(500).json({ success: false, message: '서버 에러가 발생했습니다.' });
  } finally {
    if (connection) {
      try {
        await connection.close();
      } catch (err) {
        console.error('연결 종료 에러:', err);
      }
    }
  }
});

// 사용자 회원가입 API
app.post('/api/register', async (req, res) => {
  const { username, password } = req.body;

  let connection;

  try {
    connection = await oracledb.getConnection(dbConfig);

    // 사용자 중복 확인
    const existingUser = await connection.execute(
      `SELECT * FROM user_info WHERE user_id = :username`,
      [username],
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    if (existingUser.rows.length > 0) {
      res.json({ success: false, message: '이미 존재하는 아이디입니다.' });
    } else {
      // 새로운 사용자 추가
      await connection.execute(
        `INSERT INTO user_info (user_id, user_password) VALUES (:username, :password)`,
        [username, password],
        { autoCommit: true }
      );

      res.json({ success: true });
    }
  } catch (err) {
    console.error('회원가입 에러:', err);
    res.status(500).json({ success: false, message: '서버 에러가 발생했습니다.' });
  } finally {
    if (connection) {
      try {
        await connection.close();
      } catch (err) {
        console.error('연결 종료 에러:', err);
      }
    }
  }
});

// Spotify 로그인 전에 사용자 인증 확인 미들웨어
app.use((req, res, next) => {
  if (req.path.startsWith('/spotify') && !req.session.loggedIn) {
    res.redirect('/login.html');
  } else {
    next();
  }
});

// 서버 측에서 Spotify 로그인 처리
app.get('/spotify-login', (req, res) => {
  const scopes =
    'streaming user-read-email user-read-private user-modify-playback-state user-read-playback-state';
  const authUrl = `https://accounts.spotify.com/authorize?response_type=code&client_id=${clientId}&scope=${encodeURIComponent(
    scopes
  )}&redirect_uri=${encodeURIComponent(redirectUri)}`;
  res.redirect(authUrl);
});

// Spotify 콜백 처리
app.get('/callback', async (req, res) => {
  const code = req.query.code;

  // 액세스 토큰 및 리프레시 토큰 받기
  const tokenResponse = await axios({
    method: 'post',
    url: 'https://accounts.spotify.com/api/token',
    params: {
      grant_type: 'authorization_code',
      code: code,
      redirect_uri: redirectUri,
    },
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    auth: {
      username: clientId,
      password: clientSecret,
    },
  });

  const accessToken = tokenResponse.data.access_token;
  const refreshToken = tokenResponse.data.refresh_token;

  // 사용자 프로필 정보 가져오기
  const userProfileResponse = await axios.get('https://api.spotify.com/v1/me', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  const spotifyUser = userProfileResponse.data;

  // 계정 유형 확인
  console.log('계정 유형:', spotifyUser.product);

  // 사용자 정보 업데이트
  let connection;
  try {
    connection = await oracledb.getConnection(dbConfig);

    await connection.execute(
      `UPDATE user_info SET
        user_spotify_email = :email,
        user_spotify_image_url = :imageUrl,
        user_spotify_url = :spotifyUrl,
        user_spotify_country = :country,
        user_spotify_access_token = :accessToken,
        user_spotify_refresh_token = :refreshToken
      WHERE user_id = :userId`,
      {
        email: spotifyUser.email,
        imageUrl: spotifyUser.images.length > 0 ? spotifyUser.images[0].url : null,
        spotifyUrl: spotifyUser.external_urls.spotify,
        country: spotifyUser.country,
        accessToken: accessToken,
        refreshToken: refreshToken,
        userId: req.session.username,
      },
      { autoCommit: true }
    );

    // 메인 페이지로 리다이렉트
    res.redirect('/');
  } catch (err) {
    console.error('Spotify 사용자 정보 업데이트 에러:', err);
    res.status(500).send('서버 에러가 발생했습니다.');
  } finally {
    if (connection) {
      try {
        await connection.close();
      } catch (err) {
        console.error(err);
      }
    }
  }
});

// Spotify 액세스 토큰 제공 API
app.get('/api/spotify-access-token', async (req, res) => {
  if (!req.session.loggedIn) {
    return res.json({ accessToken: null });
  }

  let connection;

  try {
    connection = await oracledb.getConnection(dbConfig);

    const result = await connection.execute(
      `SELECT user_spotify_access_token FROM user_info WHERE user_id = :userId`,
      [req.session.username],
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    let accessToken = null;

    if (result.rows.length > 0 && result.rows[0].USER_SPOTIFY_ACCESS_TOKEN) {
      accessToken = result.rows[0].USER_SPOTIFY_ACCESS_TOKEN;

      // 액세스 토큰의 유효성 확인
      const tokenValid = await isAccessTokenValid(accessToken);

      if (!tokenValid) {
        // 액세스 토큰 갱신
        accessToken = await refreshAccessToken(req.session.username);
      }
    }

    res.json({ accessToken: accessToken });
  } catch (err) {
    console.error('액세스 토큰 조회 에러:', err);
    res.status(500).json({ accessToken: null });
  } finally {
    if (connection) {
      try {
        await connection.close();
      } catch (err) {
        console.error('연결 종료 에러:', err);
      }
    }
  }
});

// 액세스 토큰 유효성 검사 함수
async function isAccessTokenValid(accessToken) {
  try {
    const response = await axios.get('https://api.spotify.com/v1/me', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
    return response.status === 200;
  } catch (err) {
    if (err.response && err.response.status === 401) {
      // 토큰 만료 또는 인증 에러
      return false;
    } else {
      // 기타 에러
      console.error('액세스 토큰 유효성 검사 에러:', err);
      return false;
    }
  }
}

// 토큰 갱신 함수
async function refreshAccessToken(userId) {
  let connection;

  try {
    connection = await oracledb.getConnection(dbConfig);

    // 리프레시 토큰 가져오기
    const result = await connection.execute(
      `SELECT user_spotify_refresh_token FROM user_info WHERE user_id = :userId`,
      [userId],
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    if (result.rows.length > 0 && result.rows[0].USER_SPOTIFY_REFRESH_TOKEN) {
      const refreshToken = result.rows[0].USER_SPOTIFY_REFRESH_TOKEN;

      // 새 액세스 토큰 요청
      const tokenResponse = await axios({
        method: 'post',
        url: 'https://accounts.spotify.com/api/token',
        params: {
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
        },
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        auth: {
          username: clientId,
          password: clientSecret,
        },
      });

      const newAccessToken = tokenResponse.data.access_token;
      const newRefreshToken = tokenResponse.data.refresh_token || refreshToken; // 새 리프레시 토큰이 없으면 기존 토큰 유지

      // 데이터베이스에 새로운 액세스 토큰 업데이트
      await connection.execute(
        `UPDATE user_info SET
          user_spotify_access_token = :accessToken,
          user_spotify_refresh_token = :refreshToken
        WHERE user_id = :userId`,
        {
          accessToken: newAccessToken,
          refreshToken: newRefreshToken,
          userId: userId,
        },
        { autoCommit: true }
      );

      return newAccessToken;
    } else {
      console.error('리프레시 토큰이 없습니다.');
      return null;
    }
  } catch (err) {
    console.error('액세스 토큰 갱신 에러:', err);
    return null;
  } finally {
    if (connection) {
      try {
        await connection.close();
      } catch (err) {
        console.error('연결 종료 에러:', err);
      }
    }
  }
}

// 정적 파일 제공 미들웨어
app.use(express.static(path.join(__dirname, 'public')));

// 환경 변수를 클라이언트로 전달하는 API
app.get('/api/client-id', (req, res) => {
  res.json({ clientId: process.env.CLIENT_ID });
});

// 서버 시작
https.createServer(sslOptions, app).listen(PORT, () => {
  console.log(`HTTPS 서버가 포트 ${PORT}에서 실행 중입니다.`);
});

console.log('DB_USER:', process.env.DB_USER);
console.log('DB_PASSWORD:', process.env.DB_PASSWORD);
console.log('DB Connect String:', dbConfig.connectString);