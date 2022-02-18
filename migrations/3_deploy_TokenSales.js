const YouTubeThumbnailToken = artifacts.require('./YouTubeThumbnailToken.sol')
const TokenSales = artifacts.require('./TokenSales.sol')
const fs = require('fs')

module.exports = function (deployer) {
  deployer.deploy(TokenSales,YouTubeThumbnailToken.address) // 이부분에서 배포시, YouTubeThumbnailToken 컨트랙의 주소를 TokenSales 생성자로 넘겨줌
    .then(() => {
      if (TokenSales._json) {
        fs.writeFile(
          'deployedABI_TokenSales',
          JSON.stringify(TokenSales._json.abi),
          (err) => {
            if (err) throw err
            console.log("파일에 ABI 입력 성공");
          })
      }

      fs.writeFile(
        'deployedAddress_TokenSales',
        TokenSales.address,
        (err) => {
          if (err) throw err
          console.log("파일에 주소 입력 성공");
        })
    })
}