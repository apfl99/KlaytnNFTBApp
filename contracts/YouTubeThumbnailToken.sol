pragma solidity ^0.5.0;

import "openzeppelin-solidity/contracts/token/ERC721/ERC721Full.sol";

contract YouTubeThumbnailToken is ERC721Full { //ERC721Full을 openzepplin라이브러리에서 상속
  
    struct YouTubeThumbnail {
        string author;
        string dateCreated;
    }

    mapping(uint256 => YouTubeThumbnail) youTubeThumbnails; // tokenId(key) -> (author, dateCreated)
    mapping(string => uint256) videoIdsCreated; // videoId(key) -> tokenId

    // ERC721Full로 넘겨 주기 위한 객체 생성(배포시 deploy_YTT의 name,symbol 사용)
    constructor(string memory name, string memory symbol) ERC721Full(name, symbol) public {}

    // 토큰 발행 
    function mintYTT(
        string memory _videoId,
        string memory _author,
        string memory _dateCreated,
        string memory _tokenURI // JSON Metadata 저장 주소 -> 가스비 절감 목적
    )
        public
    {
        require(videoIdsCreated[_videoId] == 0, "videoId has already been created"); //videoId가 key 값을 중복 검사 , 에러 메시지
        uint256 tokenId = totalSupply().add(1); // 전체 토큰 개수 + 1을 tokenId로 정의
        youTubeThumbnails[tokenId] = YouTubeThumbnail(_author, _dateCreated); // tokenId를 키로 구조체 정보 저장
        videoIdsCreated[_videoId] = tokenId; //videoId를 키로 tokenId 저장 => 같은 videoId를 가진 토큰 등록 방지

        _mint(msg.sender, tokenId); // 토큰 발행(ERC721, ERC721Enumerable 둘 다에 있음)
                                    // 그러면 어느 컨트랙에 있는 것을 사용
                                    // solidity 특성상 다중 상속시 C3 Linearization을 따름 -> 맨 오른쪽 컨트랙부터 검색
                                    // ERC721Enumerable에 있는 _mint 상속

        _setTokenURI(tokenId, _tokenURI); //tokenURI - tokenId(key) mapping
    }

    // 읽기 전용 함수 tokenId -> author, dateCreated
    function getYTT(uint256 _tokenId) public view returns(string memory, string memory) {
        return (youTubeThumbnails[_tokenId].author, youTubeThumbnails[_tokenId].dateCreated);
    }

    // videoId -> 사용 여부 확인(bool)
    function isTokenAlreadyCreated(string memory _videoId) public view returns (bool) {
        return videoIdsCreated[_videoId] != 0 ? true : false;
    }
}