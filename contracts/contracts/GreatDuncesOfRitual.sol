// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC721URIStorage} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title The Great Dunce's of Ritual
 * @notice 666 free mints to unlock Ritual Mainnet.
 * @dev    1 mint per wallet. Sequential token IDs 1..666.
 *         Per-mint metadata URI is supplied by the caller (IPFS CID assembled
 *         off-chain after the Twitter PFP is pinned to Pinata).
 *         Protocol designed by crankywakker.
 */
contract GreatDuncesOfRitual is ERC721URIStorage, Ownable, ReentrancyGuard {
    // ---------------------------------------------------------------------
    // Constants & storage
    // ---------------------------------------------------------------------

    uint256 public constant MAX_SUPPLY = 666;
    string  public constant CREATOR    = "crankywakker";

    uint256 public totalSupply;
    mapping(address => bool) public hasMinted;

    // ---------------------------------------------------------------------
    // Errors (cheaper than require strings)
    // ---------------------------------------------------------------------

    error SoldOut();
    error AlreadyMinted();
    error EmptyURI();

    // ---------------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------------

    event DunceMinted(address indexed minter, uint256 indexed tokenId, string tokenURI);

    // ---------------------------------------------------------------------
    // Constructor
    // ---------------------------------------------------------------------

    constructor(address initialOwner)
        ERC721("The Great Dunce's of Ritual", "DUNCE")
        Ownable(initialOwner)
    {}

    // ---------------------------------------------------------------------
    // Mint
    // ---------------------------------------------------------------------

    /**
     * @notice Mint your Dunce. Free — caller only pays gas.
     * @param  customTokenURI Fully-formed metadata URI (e.g. ipfs://CID/42.json)
     *                        pre-pinned server-side with the user's Twitter PFP,
     *                        sequential name "Dunce #N", and the
     *                        {"trait_type":"Creator","value":"crankywakker"} attribute.
     */
    function mintDunce(string calldata customTokenURI) external nonReentrant {
        if (bytes(customTokenURI).length == 0)  revert EmptyURI();
        if (totalSupply >= MAX_SUPPLY)          revert SoldOut();
        if (hasMinted[msg.sender])              revert AlreadyMinted();

        // Effects first (reentrancy-safe ordering)
        unchecked { totalSupply += 1; }
        uint256 newId = totalSupply; // IDs 1..666
        hasMinted[msg.sender] = true;

        // Interactions
        _safeMint(msg.sender, newId);
        _setTokenURI(newId, customTokenURI);

        emit DunceMinted(msg.sender, newId, customTokenURI);
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    function remaining() external view returns (uint256) {
        return MAX_SUPPLY - totalSupply;
    }

    // ERC721URIStorage already overrides tokenURI() to return the per-token URI
    // we set in mintDunce(). No further override needed.
}
