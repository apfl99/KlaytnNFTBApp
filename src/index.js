import Caver from "caver-js";
import { Spinner } from 'spin.js';

const config = {
  rpcURL: 'https://api.baobab.klaytn.net:8651'
}
const cav = new Caver(config.rpcURL);
const yttContract = new cav.klay.Contract(DEPLOYED_ABI, DEPLOYED_ADDRESS);

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
    // ...
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
  
  //#region setting token view UI My/All
  displayMyTokensAndSale: async function (walletInstance) {       
   var balance = parseInt(await this.getBalanceOf(walletInstance.address)); // 계정 보유 토큰 개수 리턴

   if (balance === 0) {
     $('#myTokens').text("현재 보유한 토큰이 없습니다.");
   } else {
     for (var i = 0; i < balance; i++) {
      (async () => {
        // 토큰 정보 저장
        var tokenId = await this.getTokenOfOwnerByIndex(walletInstance.address, i);
        var tokenUri = await this.getTokenUri(tokenId);
        var ytt = await this.getYTT(tokenId);
        var metadata = await this.getMetadata(tokenUri);
        this.renderMyTokens(tokenId, ytt, metadata); // HTML rendering
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

  renderMyTokens: function (tokenId, ytt, metadata) {    
    var tokens = $('#myTokens');

    //template rendering
    var template = $('#MyTokensTemplate');
    template.find('.panel-heading').text(tokenId);
    template.find('img').attr('src', metadata.properties.image.description);
    template.find('img').attr('title', metadata.properties.description.description);
    template.find('.video-id').text(metadata.properties.name.description);
    template.find('.author').text(ytt[0]);
    template.find('.date-created').text(ytt[1]);

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
          this.renderAllTokens(tokenId, ytt, metadata); // HTML rendering
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

  renderAllTokens: function (tokenId, ytt, metadata) {   
    var tokens = $('#allTokens');

    //template rendering
    var template = $('#AllTokensTemplate');
    template.find('.panel-heading').text(tokenId);
    template.find('img').attr('src', metadata.properties.image.description);
    template.find('img').attr('title', metadata.properties.description.description);
    template.find('.video-id').text(metadata.properties.name.description);
    template.find('.author').text(ytt[0]);
    template.find('.date-created').text(ytt[1]);

    tokens.append(template.html()); //template -> tokens (AllTokensTemplate -> allTokens)
  },    
  //#endregion setting token view UI


  renderMyTokensSale: function (tokenId, ytt, metadata, price) { 
   
  },


  approve: function () {
      
  },

  cancelApproval: async function () {
          
  },

  checkApproval: async function(walletInstance) {
       
  },

  sellToken: async function (button) {    
       
  },

  buyToken: async function (button) {
      
  },

  onCancelApprovalSuccess: async function (walletInstance) {
  
  },     
  
  isApprovedForAll: async function (owner, operator) {
 
  },  

  getTokenPrice: async function (tokenId) {
   
  },  

  getOwnerOf: async function (tokenId) {
   
  },

  getBasicTemplate: function(template, tokenId, ytt, metadata) {  
  
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