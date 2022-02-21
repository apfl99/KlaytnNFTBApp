pragma solidity ^0.5.0;

import "openzeppelin-solidity/contracts/token/ERC721/ERC721Full.sol";

contract TokenSales {

ERC721Full public nftAddress; // YouTubeThumbnailToken 컨트랙을 불러오기 위한 변수
mapping(uint256 => uint256) public tokenPrice; // _tokenId(key) -> _price

constructor(address _tokenAddress) public { // _tokenAddress : YouTubeThumbnailToken 배포 주소 -> YouTubeThumbnailToken 컨트랙 주소는 3_deploy_TokenSales.js 에서 배포시 넘겨줌
      nftAddress = ERC721Full(_tokenAddress); // tokenAddress를 매개로 해당 컨트랙의 ERC721Full의 모든 내용을 참조할 수 있게 함
}

//토큰 판매 등록
function setForSale(uint256 _tokenId, uint256 _price) public {
    address tokenOwner = nftAddress.ownerOf(_tokenId); // nftAddress를 활용하여 ERC721 기능 사용(소유자 가져오기)

    //유효성 검사
    require(tokenOwner == msg.sender, "caller is not token owner"); // 함수 호출 계정이 소유자 인지 확인
    require(_price > 0, "price is zero or lower"); // 판매 가격 확인
    require(nftAddress.isApprovedForAll(tokenOwner, address(this)),"token owner did not approve TokenSales contract"); // 해당 컨트랙에 소유자가 권한 부여를 했는지 확인

    tokenPrice[_tokenId] = _price; // 토큰별 가격 블록체인에 저장
}

//토큰 구매
function purchaseToken(uint256 _tokenId) public payable {
    uint256 price = tokenPrice[_tokenId]; // 가격
    address tokenSeller = nftAddress.ownerOf(_tokenId); // 토큰 소유자(판매자)

    //유효성 검사
    require(msg.value >= price, "caller sent klay lower then price"); // 지정된 값 미만 
    require(msg.sender != tokenSeller, "caller is token seller"); // 판매자가 구매할 수 X

    //solidity 5이상부터 돈을 받게 되는 계정이 payable 타입 이어야 함
    address payable payableTokenSeller = address(uint160(tokenSeller));

    payableTokenSeller.transfer(msg.value); // 구매(판매자 계정으로 송금)
    nftAddress.safeTransferFrom(tokenSeller, msg.sender, _tokenId); // 토큰 안전한 전송

    tokenPrice[_tokenId] = 0; // 거래 완료된 토큰을 구매할 수 없도록 함 - 판매 등록 유효성 검사 참고
}

//토큰 판매 등록 철회
function removeTokenOnSale(uint256[] memory tokenIds) public { // 계정이 소유한 토큰 중 판매중인 tokenId 받아옴

    //유효성 검사
    require(tokenIds.length > 0, "tokenIds is empty"); // 판매중인 토큰이 존재 여부 검사

    for(uint i = 0; i < tokenIds.length; i++) {
        uint256 tokenId = tokenIds[i];
        address tokenSeller = nftAddress.ownerOf(tokenId);

        // 유효성 검사
        require(msg.sender == tokenSeller, "caller is not token seller"); // 함수 호출 계정이 소유자인지 확인

        tokenPrice[tokenId] = 0; // 토큰을 구매할 수 없도록 함(판매 등록 철회) - 판매 등록 유효성 검사 참고
    }
}

}