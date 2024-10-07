document.addEventListener("DOMContentLoaded", () => {
  let clientId = null; // 환경 변수에서 가져오기
  let accessToken = null;
  let player = null;
  let deviceId = null;

  // 서버에서 clientId 가져오기
  fetch("/api/client-id")
    .then((response) => response.json())
    .then((data) => {
      clientId = data.clientId;
      console.log("Client ID:", clientId);

      // 여기서 clientId를 사용하는 로직 추가 가능
    })
    .catch((error) => {
      console.error("Client ID를 가져오는 중 오류 발생:", error);
    });

  // Spotify 로그인 버튼 요소 가져오기
  const spotifyLoginButton = document.getElementById("spotify-login-button");

  // 사용자 로그인 여부 확인
  fetch("/api/check-login")
    .then((response) => response.json())
    .then((data) => {
      if (!data.loggedIn) {
        window.location.href = "/login.html";
      } else {
        // 로그인된 경우 Spotify 로그인 버튼 표시
        spotifyLoginButton.style.display = "block";

        // 서버에서 Spotify 액세스 토큰 확인
        fetch("/api/spotify-access-token")
          .then((response) => response.json())
          .then((tokenData) => {
            if (tokenData.accessToken) {
              accessToken = tokenData.accessToken;
              spotifyLoginButton.style.display = "none";
              document.getElementById("player-controls").style.display =
                "block";
              initializePlayer();
            } else {
              // Spotify 로그인 필요
              spotifyLoginButton.style.display = "block";
            }
          });
      }
    });

  // Spotify 로그인 버튼 클릭 시 처리
  spotifyLoginButton.addEventListener("click", handleLogin);

  function handleLogin() {
    window.location = "/spotify-login";
  }

  // window 객체에 onSpotifyWebPlaybackSDKReady 함수 정의
  window.onSpotifyWebPlaybackSDKReady = () => {
    if (accessToken) {
      initializePlayer();
    }
  };

  function initializePlayer() {
    player = new Spotify.Player({
      name: "Spotify Web Player",
      getOAuthToken: (cb) => {
        cb(accessToken);
      },
      volume: 0.5,
    });

    // 이벤트 리스너 설정
    player.addListener("ready", ({ device_id }) => {
      console.log("플레이어가 준비되었습니다.", device_id);
      deviceId = device_id;
      localStorage.setItem("deviceId", device_id);
    });

    player.addListener("not_ready", ({ device_id }) => {
      console.log("플레이어가 준비되지 않았습니다.", device_id);
    });

    player.addListener("player_state_changed", (state) => {
      if (state) {
        updateCurrentTrack(state);
      }
    });

    // 에러 처리
    player.addListener("initialization_error", ({ message }) => {
      console.error("초기화 에러:", message);
    });

    player.addListener("authentication_error", ({ message }) => {
      console.error("인증 에러:", message);
    });

    player.addListener("account_error", ({ message }) => {
      console.error("계정 에러:", message);
    });

    // 플레이어 연결
    player.connect();
  }

  function updateCurrentTrack(state) {
    const track = state.track_window.current_track;
    document.getElementById("album-image").src = track.album.images[0].url;
    document.getElementById("track-name").innerText = track.name;
    document.getElementById("artist-name").innerText = track.artists
      .map((artist) => artist.name)
      .join(", ");
  }

  let currentPage = 1;
  const itemsPerPage = 10; // 한 페이지에 표시할 항목 수

  function searchTracks(query, page = 1) {
    const offset = (page - 1) * itemsPerPage;

    fetch(
      `https://api.spotify.com/v1/search?q=${encodeURIComponent(
        query
      )}&type=track&limit=${itemsPerPage}&offset=${offset}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    )
      .then((response) => response.json())
      .then((data) => {
        displaySearchResults(data.tracks.items);
        setupPagination(data.tracks.total, page, query);
      })
      .catch((error) => console.error("검색 에러:", error));
  }

  function setupPagination(totalItems, currentPage, query) {
    const pagination = document.getElementById("pagination");
    pagination.innerHTML = "";

    const totalPages = Math.ceil(totalItems / itemsPerPage);

    // 이전 페이지 버튼
    if (currentPage > 1) {
      const prevButton = document.createElement("button");
      prevButton.innerText = "이전";
      prevButton.addEventListener("click", () => {
        searchTracks(query, currentPage - 1);
      });
      pagination.appendChild(prevButton);
    }

    // 페이지 번호 표시
    const pageIndicator = document.createElement("span");
    pageIndicator.innerText = `페이지 ${currentPage} / ${totalPages}`;
    pagination.appendChild(pageIndicator);

    // 다음 페이지 버튼
    if (currentPage < totalPages) {
      const nextButton = document.createElement("button");
      nextButton.innerText = "다음";
      nextButton.addEventListener("click", () => {
        searchTracks(query, currentPage + 1);
      });
      pagination.appendChild(nextButton);
    }
  }

  function displaySearchResults(tracks) {
    const searchResults = document.getElementById("search-results");
    searchResults.innerHTML = "";

    tracks.forEach((track) => {
      const trackItem = document.createElement("div");
      trackItem.classList.add("track-item");

      const albumImage = document.createElement("img");
      albumImage.src = track.album.images[0] ? track.album.images[0].url : "";

      const trackDetails = document.createElement("div");
      trackDetails.classList.add("track-details");

      const trackName = document.createElement("div");
      trackName.innerText = track.name;

      const artistName = document.createElement("div");
      artistName.innerText = track.artists
        .map((artist) => artist.name)
        .join(", ");

      trackDetails.appendChild(trackName);
      trackDetails.appendChild(artistName);

      const playButton = document.createElement("button");
      playButton.innerText = "재생";
      playButton.addEventListener("click", () => {
        playTrack(deviceId, track.uri);
      });

      trackItem.appendChild(albumImage);
      trackItem.appendChild(trackDetails);
      trackItem.appendChild(playButton);

      searchResults.appendChild(trackItem);
    });
  }

  // 검색 버튼 이벤트 리스너 수정
  document.getElementById("search-button").addEventListener("click", () => {
    const query = document.getElementById("search-input").value;
    if (query) {
      currentPage = 1; // 새로운 검색 시 페이지를 1로 초기화
      searchTracks(query, currentPage);
    }
  });

  function playTrack(deviceId, trackUri) {
    fetch(`https://api.spotify.com/v1/me/player/play?device_id=${deviceId}`, {
      method: "PUT",
      body: JSON.stringify({ uris: [trackUri] }),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
    })
      .then(() => {
        console.log("재생 시작:", trackUri);
      })
      .catch((error) => console.error("재생 에러:", error));
  }

  // 이벤트 리스너 등록
  document.getElementById("search-button").addEventListener("click", () => {
    const query = document.getElementById("search-input").value;
    if (query) {
      searchTracks(query);
    }
  });

  document.getElementById("play-button").addEventListener("click", () => {
    player.togglePlay();
  });

  document.getElementById("next-button").addEventListener("click", () => {
    player.nextTrack();
  });

  document.getElementById("previous-button").addEventListener("click", () => {
    player.previousTrack();
  });
});
