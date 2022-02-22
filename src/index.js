import Caver from "caver-js";
import { Spinner } from 'spin.js';

const config = {
  rpcURL: 'https://api.baobab.klaytn.net:8651'
}
const cav = new Caver(config.rpcURL);
const yttContract = new cav.klay.Contract(DEPLOYED_ABI, DEPLOYED_ADDRESS);
const tsContract = new cav.klay.Contract(DEPLOYED_ABI_TOKENSALES, DEPLOYED_ADDRESS_TOKENSALES);

//ipfs setting
var ipfsClient = require('ipfs-http-client');
var ipfs = ipfsClient({ host: 'infura-ipfs.io', port: '5001', protocol: 'https' });

const App = {
  auth: {
    accessType: 'keystore',
    keystore: '',
    password: ''
  },

  //#region 계정 인증
  
  start: async function () {
    const walletFromSession = sessionStorage.getItem('walletInstance');
    if (walletFromSession) {
      try {
        cav.klay.accounts.wallet.add(JSON.parse(walletFromSession));
        this.changeUI(JSON.parse(walletFromSession));
      } catch (e) {
        sessionStorage.removeItem('walletInstance');
      }
    }
  },

  handleImport: async function () {
    const fileReader = new FileReader();
    fileReader.readAsText(event.target.files[0]);
    fileReader.onload = (event) => {
      try {
        if (!this.checkValidKeystore(event.target.result)) {
          $('#message').text('유효하지 않은 keystore 파일입니다.');
          return;
        }
        this.auth.keystore = event.target.result;
        $('#message').text('keystore 통과. 비밀번호를 입력하세요.');
        document.querySelector('#input-password').focus();
      } catch (event) {
        $('#message').text('유효하지 않은 keystore 파일입니다.');
        return;
      }
    }
  },

  handlePassword: async function () {
    this.auth.password = event.target.value;
  },

  handleLogin: async function () {
    if (this.auth.accessType === 'keystore') {
      try {
        const privateKey = cav.klay.accounts.decrypt(this.auth.keystore, this.auth.password).privateKey;
        this.integrateWallet(privateKey);
      } catch (e) {
        $('#message').text('비밀번호가 일치하지 않습니다.');
      }
    }
  },

  handleLogout: async function () {
    this.removeWallet();
    location.reload();
  }, 

  getWallet: function () {
    if (cav.klay.accounts.wallet.length) {
      return cav.klay.accounts.wallet[0];
    }
  },

  checkValidKeystore: function (keystore) {
    const parsedKeystore = JSON.parse(keystore);
    const isValidKeystore = parsedKeystore.version &&
      parsedKeystore.id &&
      parsedKeystore.address &&
      parsedKeystore.keyring;

    return isValidKeystore;
  },

  integrateWallet: function (privateKey) {
    const walletInstance = cav.klay.accounts.privateKeyToAccount(privateKey);
    cav.klay.accounts.wallet.add(walletInstance)
    sessionStorage.setItem('walletInstance', JSON.stringify(walletInstance));
    this.changeUI(walletInstance);
  },

  reset: function () {
    this.auth = {
      keystore: '',
      password: ''
    };
  },

  changeUI: async function (walletInstance) {
    $('#loginModal').modal('hide');
    $("#login").hide();
    $('#logout').show();
    $('.afterLogin').show();
    $('#address').append('<br>' + '<p>' + '내 계정 주소: ' + walletInstance.address + '</p>');  
    
    await this.displayMyTokensAndSale(walletInstance);
    await this.displayAllTokens(walletInstance);
    await this.checkApproval(walletInstance);
  },

  removeWallet: function () {
    cav.klay.accounts.wallet.clear();
    sessionStorage.removeItem('walletInstance');
    this.reset();
  }, 

  showSpinner: function () {
    var target = document.getElementById('spin');
    return new Spinner(opts).spin(target);
  },
  //#endregion

  //#region videoId로 토큰 유효성 검사
  checkTokenExists: async function () {   
    var videoId = $('#video-id').val();
    var result = await this.isTokenAlreadyCreated(videoId); // 토큰 유효성 검사

    if (result) {
      $('#t-message').text('이미 토큰화된 썸네일 입니다');
    } else {
      $('#t-message').text('토큰화 가능한 썸네일 입니다.');
      $('.btn-create').prop("disabled", false);
    }
  },

  isTokenAlreadyCreated: async function (videoId) {
    return await yttContract.methods.isTokenAlreadyCreated(videoId).call(); //from YoutubeThumbnailToken.sol
  },

  //#endregion videoId로 토큰 유효성 검사

  //#region 토큰 발행 + 가스비 대납
  createToken: async function () {   
    var spinner = this.showSpinner();
    //입력값 가져오기
    var videoId = $('#video-id').val();
    var title = $('#title').val();
    var author = $('#author').val();
    var dateCreated = $('#date-created').val();

    //미입력 검사
    if (!videoId || !title || !author || !dateCreated) {
      spinner.stop();
      return;
    }

    try {
      //ERC721 Metadata JSON Schema
      const metaData = this.getERC721MetadataSchema(videoId, title, `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`);
      var res = await ipfs.add(Buffer.from(JSON.stringify(metaData))); //ipfs에 파일 업로드 후 해쉬 값을 저장 -> 해쉬 값을 통해 용량 및 가스비 절감
      await this.mintYTT(videoId, author, dateCreated, res[0].hash); // 블록체인에 토큰 발행 + 가스비 대납 
    } catch (err) {
      console.error(err);
      spinner.stop();
    }
  },  

  //ERC721 Metadata JSON Schema format
  getERC721MetadataSchema: function (videoId, title, imgUrl) {
    return {
      "title": "Asset Metadata",
      "type": "object",
      "properties": {
          "name": {
              "type": "string",
              "description": videoId
          },
          "description": {
              "type": "string",
              "description": title
          },
          "image": {
              "type": "string",
              "description": imgUrl
          }
      }
    }
  },

  mintYTT: async function (videoId, author, dateCreated, hash) {    
    const sender = this.getWallet(); // 로그인 사용자
    const feePayer = cav.klay.accounts.wallet.add('0x270c77a5676ff167567ca278e31cb32032b771e9072f0f56dea49a72e4e81eba') // 대납 계정

    // using the promise
    // 트랜잭션 서명
    const { rawTransaction: senderRawTransaction } = await cav.klay.accounts.signTransaction({
      type: 'FEE_DELEGATED_SMART_CONTRACT_EXECUTION', // 대납
      from: sender.address, // 로그인 사용자
      to:   DEPLOYED_ADDRESS, // 배포된 컨트랙 주소
      data: yttContract.methods.mintYTT(videoId, author, dateCreated, "https://infura-ipfs.io/ipfs/" + hash).encodeABI(), // 토큰 발행 from YouTubeThumbnailToken.sol
      gas:  '500000',
      value: cav.utils.toPeb('0', 'KLAY'), // payable이 아니므로 0입력
    }, sender.privateKey) // 서명

    // 트랜잭션 보내기
    cav.klay.sendTransaction({
      senderRawTransaction: senderRawTransaction,
      feePayer: feePayer.address,
    })
    // 영수증
    .then(function(receipt){
      if (receipt.transactionHash) {
        console.log("https://infura-ipfs.io/ipfs/" + hash);
        alert(receipt.transactionHash);
        location.reload();
      }
    });
  },    
  //#endregion 토큰 발행 + 가스비 대납
  
  //#region setting token view UI MyAndSale/All
  displayMyTokensAndSale: async function (walletInstance) {    
  var balance = parseInt(await this.getBalanceOf(walletInstance.address)); // 계정 보유 토큰 개수 리턴

   if (balance === 0) {
     $('#myTokens').text("현재 보유한 토큰이 없습니다.");
   } else {
     var isApproved = await this.isApprovedForAll(walletInstance.address, DEPLOYED_ADDRESS_TOKENSALES); // 승인 여부 값
     for (var i = 0; i < balance; i++) {
      (async () => {
        // 토큰 정보 저장
        var tokenId = await this.getTokenOfOwnerByIndex(walletInstance.address, i);
        var tokenUri = await this.getTokenUri(tokenId);
        var ytt = await this.getYTT(tokenId);
        var metadata = await this.getMetadata(tokenUri);
        var price = await this.getTokenPrice(tokenId);
        this.renderMyTokens(tokenId, ytt, metadata, isApproved, price); // HTML rendering

        if (parseInt(price) > 0){ // 판매중인 토큰 탭 렌더링
          this.renderMyTokensSale(tokenId, ytt, metadata, price);
        }

      })();      
     }
   }
  },   

  getBalanceOf: async function (address) {
    return await yttContract.methods.balanceOf(address).call(); //from ERC721
  },

  getTokenOfOwnerByIndex: async function (address, index) {
    return await yttContract.methods.tokenOfOwnerByIndex(address, index).call(); //from ERC721Enumerable.sol
  },

  getTokenUri: async function (tokenId) {
    return await yttContract.methods.tokenURI(tokenId).call(); // from ERC721Metadata.sol
  },

  getYTT: async function (tokenId) {
    return await yttContract.methods.getYTT(tokenId).call(); // from YouTubeThumbnailToken.sol
  },

  getMetadata: function (tokenUri) {
    //tokenUri -> metadata
    return new Promise((resolve) => {
      $.getJSON(tokenUri, data => {
        resolve(data);
      })
    })
  },

  renderMyTokens: function (tokenId, ytt, metadata, isApproved, price) {    
    var tokens = $('#myTokens');

    //template rendering
    var template = $('#MyTokensTemplate');
    this.getBasicTemplate(template, tokenId, ytt, metadata);

    // 판매 버튼 조정
    if(isApproved) { //승인 완료 토큰
      if (parseInt(price) > 0) { // 판매중인 토큰
        template.find('.sell-token').hide();
      } else { // 판매 승인만 한 토큰
        template.find('.sell-token').show();
      }
    }

    tokens.append(template.html()); //template -> tokens (MyTokensTemplate -> myTokens)
  },

  displayAllTokens: async function (walletInstance) {   
    var totalSupply = parseInt(await this.getTotalSupply()); // 전체 토큰 개수 리턴

    if (totalSupply === 0) {
      $('#allTokens').text("현재 발행된 토큰이 없습니다.");
    } else {
      for (var i = 0; i < totalSupply; i++) {
        (async () => {
          //토큰 정보 저장
          var tokenId = await this.getTokenByIndex(i);
          var tokenUri = await this.getTokenUri(tokenId);
          var ytt = await this.getYTT(tokenId);
          var metadata = await this.getMetadata(tokenUri);
          var price = await this.getTokenPrice(tokenId);
          var owner = await this.getOwnerOf(tokenId); // 구매 =! 판매 계정 확인
          this.renderAllTokens(tokenId, ytt, metadata, price, owner, walletInstance); // HTML rendering
        })();
      }
    }
  },

  getTotalSupply: async function () {
    return await yttContract.methods.totalSupply().call(); // from ERC721Enumerable.sol
  },

  getTokenByIndex: async function (index) {
    return await yttContract.methods.tokenByIndex(index).call(); // from ERC721Enumerable.sol
  },

  renderAllTokens: function (tokenId, ytt, metadata, price, owner, wallletInstance) {   
    var tokens = $('#allTokens');

    //template rendering
    var template = $('#AllTokensTemplate');
    this.getBasicTemplate(template, tokenId, ytt, metadata);

    if(parseInt(price) > 0) { // 판매 중인 토큰

      // 구매 UI 활성화
      template.find('.buy-token').show();
      template.find('.token-price').text(cav.utils.fromPeb(price, 'KLAY') + " KLAY");

      if(owner.toUpperCase() === wallletInstance.address.toUpperCase()) { // 토큰 소유자와 현재 접속 계정이 같을 경우 
        template.find('.btn-buy').attr('disabled', true); // 구매 비활성화
      } else { // 다를 경우
        template.find('.btn-buy').attr('disabled', false); // 구매 활성화
      }
    } else { // 판매 중인 토큰이 아닐 경우
      template.find('.buy-token').hide(); // 구매 UI 비활성화
    }

    tokens.append(template.html()); //template -> tokens (AllTokensTemplate -> allTokens)
  },

  renderMyTokensSale: function (tokenId, ytt, metadata, price) { 
    var tokens = $('#myTokensSale');

    //template rendering
    var template = $('#MyTokensSaleTemplate');
    this.getBasicTemplate(template, tokenId, ytt, metadata);
    template.find('.on-sale').text(cav.utils.fromPeb(price, 'KLAY') + " KLAY에 판매중");

    tokens.append(template.html()); //template -> tokens (AllTokensTemplate -> allTokens)
  },

  // 판매 중 여부를 결정할 price 받아오기
  getTokenPrice: async function (tokenId) {
    return await tsContract.methods.tokenPrice(tokenId).call(); // tokenPrice : tokenId -> price
   }, 

   // 토큰 소유자 조회
   getOwnerOf: async function (tokenId) {
    return await yttContract.methods.ownerOf(tokenId).call();
   },
  //#endregion setting token view UI MyAndSale/All

  //#region 토큰 판매 승인 및 취소

  // 토큰 판매 승인
  approve: function () {
    this.showSpinner();
    const walletInstance = this.getWallet();

    // 토큰 판매 승인(토큰 소유 계정 대신 컨트랙이 토큰을 전송할 수 있도록) : 현 계정(토큰 소유 계정) -> TOKENSALES 컨트랙 
    yttContract.methods.setApprovalForAll(DEPLOYED_ADDRESS_TOKENSALES, true).send({
      from: walletInstance.address,
      gas: '250000' 
    }).then(function (receipt) {
      if (receipt.transactionHash) {
        location.reload();
      }
    });
  },

  // 토큰 판매 승인 여부 리턴 -> displayMyTokensAndSale 등 사용
  isApprovedForAll: async function (owner, operator) {
    return await yttContract.methods.isApprovedForAll(owner,operator).call(); //owner : 토큰 소유 계정, operator : 승인 컨트랙 주소
  },
  
  // 토큰 판매 승인 취소(승인에서 매개값만 false)
  cancelApproval: async function () {
    this.showSpinner();
    const walletInstance = this.getWallet();
    const receipt = await yttContract.methods.setApprovalForAll(DEPLOYED_ADDRESS_TOKENSALES, false).send({ 
      from: walletInstance.address,
      gas: '250000' 
    })

    if(receipt.transactionHash) {
      await this.onCancelApprovalSuccess(walletInstance);
      location.reload();
    }

  },

  // 판매 승인 상태 확인 및 UI 변경 -> changeUI call
  checkApproval: async function(walletInstance) {
    var isApproved = await this.isApprovedForAll(walletInstance.address, DEPLOYED_ADDRESS_TOKENSALES); // 판매 승인 여부 저장

    // 판매 승인 버튼
    if (isApproved) { 
      $('#approve').hide();
    } else {
      $('#cancelApproval').hide();
    }
  },
  //#endregion 토큰 판매 승인 및 취소

  //#region 토큰 판매 등록(대납)
  sellToken: async function (button) {
    // button에서 받아온 데이터 저장
    var divInfo = $(button).closest('.panel-primary');
    var tokenId = divInfo.find('.panel-heading').text();
    var amount = divInfo.find('.amount').val();

    // 가격이 0보다 작을 경우 종료
    if (amount <= 0) 
      return;

    try {
      var spinner = this.showSpinner();

      // mintYTT와 유사(대납)
      const sender = this.getWallet(); // 로그인 사용자
      const feePayer = cav.klay.accounts.wallet.add('0x270c77a5676ff167567ca278e31cb32032b771e9072f0f56dea49a72e4e81eba') // 대납 계정

      // using the promise
      // 트랜잭션 서명
      const { rawTransaction: senderRawTransaction } = await cav.klay.accounts.signTransaction({
        type: 'FEE_DELEGATED_SMART_CONTRACT_EXECUTION', // 대납
        from: sender.address, // 로그인 사용자
        to:   DEPLOYED_ADDRESS_TOKENSALES, // 판매 컨트랙 주소
        data: tsContract.methods.setForSale(tokenId, cav.utils.toPeb(amount, 'KLAY')).encodeABI(), // 판매 등록(tokenId -> price 저장)
        gas:  '500000',
        value: cav.utils.toPeb('0', 'KLAY'), // payable이 아니므로 0입력
      }, sender.privateKey) // 서명

      cav.klay.sendTransaction({
        senderRawTransaction: senderRawTransaction,
        feePayer: feePayer.address,
      })
      .then(function(receipt){
        if (receipt.transactionHash) {
          alert(receipt.transactionHash);
          location.reload();
        }
      });
    } catch(err) {
      console.error(err);
      spinner.stop();
    }
  },
  //#endregion 토큰 판매 등록(대납)
 
  //#region 토큰 구매(구매 가스비에 대한 대납)
  buyToken: async function (button) {
    // button에서 받아온 데이터 저장
    var divInfo = $(button).closest('.panel-primary');
    var tokenId = divInfo.find('.panel-heading').text();
    var price = await this.getTokenPrice(tokenId);

    // 가격이 0보다 작을 경우 종료
    if (price <= 0) 
      return;
  
    //mint YTT 대납과 유사
    try {
      var spinner = this.showSpinner();
      const sender = this.getWallet(); // 로그인 사용자
      const feePayer = cav.klay.accounts.wallet.add('0x270c77a5676ff167567ca278e31cb32032b771e9072f0f56dea49a72e4e81eba') // 대납 계정

      // using the promise
      // 트랜잭션 서명
      const { rawTransaction: senderRawTransaction } = await cav.klay.accounts.signTransaction({
        type: 'FEE_DELEGATED_SMART_CONTRACT_EXECUTION', // 대납
        from: sender.address, // 로그인 사용자
        to:   DEPLOYED_ADDRESS_TOKENSALES, // 배포된 컨트랙 주소
        data: tsContract.methods.purchaseToken(tokenId).encodeABI(), // 구매 from TokenSales.sol
        gas:  '500000',
        value: price // 토큰 구입 가격
      }, sender.privateKey) // 서명

      cav.klay.sendTransaction({
        senderRawTransaction: senderRawTransaction,
        feePayer: feePayer.address,
      })
      .then(function(receipt){
        if (receipt.transactionHash) {
          alert(receipt.transactionHash);
          location.reload();
        }
      });
    } catch(err) {
      console.error(err);
      spinner.stop();
    }
  },
  //#endregion 토큰 구매

  //#region 판매 승인 취소 시 기존 판매 중인 토큰 판매 등록 철회
  onCancelApprovalSuccess: async function (walletInstance) {
    var balance = parseInt(await this.getBalanceOf(walletInstance.address)); // 토큰 소유 개수

    if (balance > 0) {
      var tokensOnSale = []; // 판매 중인 토큰의 tokenId 넣을 배열 
      for (var i = 0; i < balance; i++) {
        // tokenId -> price -> price > 0 로 판매 중인 토큰의 tokenId get
        var tokenId = await this.getTokenOfOwnerByIndex(walletInstance.address, i);
        var price = await this.getTokenPrice(tokenId);
        if (parseInt(price) > 0)
          tokensOnSale.push(tokenId);
      }

      if (tokensOnSale.length > 0) { 
        const receipt = await tsContract.methods.removeTokenOnSale(tokensOnSale).send({ // from TokenSales.sol : 판매 등록 철회
          from: walletInstance.address,
          gas: '250000'
        });

        if (receipt.transactionHash)
          alert(receipt.transactionHash);
      }
    }
  },
  //#endregion 판매 승인 취소 시 기존 판매 중인 토큰 토큰 판매 등록 철회

  // 기본 UI
  getBasicTemplate: function(template, tokenId, ytt, metadata) {  
    template.find('.panel-heading').text(tokenId);
    template.find('img').attr('src', metadata.properties.image.description);
    template.find('img').attr('title', metadata.properties.description.description);
    template.find('.video-id').text(metadata.properties.name.description);
    template.find('.author').text(ytt[0]);
    template.find('.date-created').text(ytt[1]);
  }
};

window.App = App;

window.addEventListener("load", function () {
  App.start(); 
  $("#tabs").tabs().css({'overflow': 'auto'});
});

var opts = {
  lines: 10, // The number of lines to draw
  length: 30, // The length of each line
  width: 17, // The line thickness
  radius: 45, // The radius of the inner circle
  scale: 1, // Scales overall size of the spinner
  corners: 1, // Corner roundness (0..1)
  color: '#5bc0de', // CSS color or array of colors
  fadeColor: 'transparent', // CSS color or array of colors
  speed: 1, // Rounds per second
  rotate: 0, // The rotation offset
  animation: 'spinner-line-fade-quick', // The CSS animation name for the lines
  direction: 1, // 1: clockwise, -1: counterclockwise
  zIndex: 2e9, // The z-index (defaults to 2000000000)
  className: 'spinner', // The CSS class to assign to the spinner
  top: '50%', // Top position relative to parent
  left: '50%', // Left position relative to parent
  shadow: '0 0 1px transparent', // Box-shadow for the lines
  position: 'absolute' // Element positioning
};