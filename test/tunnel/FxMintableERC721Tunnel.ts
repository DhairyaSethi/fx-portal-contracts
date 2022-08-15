import chai, { expect } from "chai";
import { Signer } from "ethers";
import { ethers } from "hardhat";
import { solidity } from "ethereum-waffle";
import { minimalProxyCreationCode } from "../shared/utilities";
import { getCreate2AddressFromSalt } from "../shared/utilities";
import { childFixture } from "../shared/fixtures";
import { FxERC721 } from "../../types/FxERC721";
import { FxMintableERC721ChildTunnel } from "../../types/FxMintableERC721ChildTunnel";
import { FxMintableERC721RootTunnel } from "../../types/FxMintableERC721RootTunnel";
import { rootFixture } from "../shared/fixtures";

import { ChildFixture, RootFixture } from "../shared/fixtures";
import { keccak256, solidityPack } from "ethers/lib/utils";
import { FxERC721__factory } from "../../types/factories/FxERC721__factory";

chai.use(solidity);

const TOKEN_IDS = { ONE: 1, TWO: 2 };
const TRANSFER_DATA = "0x";
const ZERO_ADDRESS = ethers.constants.AddressZero;

describe("FxMintableERC721Tunnel", () => {
  let wallet: Signer;
  let other: Signer;
  let fxERC721: FxERC721;
  let fxMintableERC721ChildTunnel: FxMintableERC721ChildTunnel;
  let fxMintableERC721RootTunnel: FxMintableERC721RootTunnel;

  beforeEach(async () => {
    const signers = await ethers.getSigners();
    wallet = signers[0];
    other = signers[1];
    const cFixture: ChildFixture = await childFixture(signers);
    fxERC721 = cFixture.mintableERC721Token;
    fxMintableERC721ChildTunnel = cFixture.mintableErc721;
    const rFixture: RootFixture = await rootFixture(signers, cFixture);
    fxMintableERC721RootTunnel = rFixture.mintableErc721;

    await fxERC721.mint(
      await wallet.getAddress(),
      TOKEN_IDS.ONE,
      TRANSFER_DATA
    );
  });

  it.only("fxChild, deployToken success", async () => {
    const uniqueId = 0;
    const childSalt = keccak256(solidityPack(["uint256"], [uniqueId]));
    const expectedChildTokenAddress = getCreate2AddressFromSalt(
      fxMintableERC721ChildTunnel.address,
      childSalt,
      minimalProxyCreationCode(fxERC721.address)
    );

    const rootSalt = keccak256(
      solidityPack(["address"], [expectedChildTokenAddress])
    );
    const expectedRootTokenAddress = getCreate2AddressFromSalt(
      fxMintableERC721RootTunnel.address,
      rootSalt,
      minimalProxyCreationCode(fxERC721.address)
    );

    let childTokenMap = await fxMintableERC721ChildTunnel.rootToChildToken(
      expectedRootTokenAddress
    );
    let rootTokenMap = await fxMintableERC721RootTunnel.rootToChildTokens(
      expectedRootTokenAddress
    );
    expect(childTokenMap).to.eq(rootTokenMap);
    expect(childTokenMap).to.eq(ZERO_ADDRESS);

    await expect(
      fxMintableERC721ChildTunnel.deployChildToken(
        uniqueId,
        await fxERC721.name(),
        await fxERC721.symbol()
      )
    )
      .to.emit(fxMintableERC721ChildTunnel, "TokenMapped")
      .withArgs(expectedRootTokenAddress, expectedChildTokenAddress);

    childTokenMap = await fxMintableERC721ChildTunnel.rootToChildToken(
      expectedRootTokenAddress
    );

    expect(childTokenMap).to.eq(expectedChildTokenAddress);

    // root token map still unset
    rootTokenMap = await fxMintableERC721RootTunnel.rootToChildTokens(
      expectedRootTokenAddress
    );
    expect(rootTokenMap).to.eq(ZERO_ADDRESS);

    const childTokenInstance = new FxERC721__factory(wallet).attach(
      expectedChildTokenAddress
    );

    let balance = await childTokenInstance.balanceOf(await wallet.getAddress());
    expect(balance).to.eq(0);

    await fxMintableERC721ChildTunnel.mintToken(
      expectedChildTokenAddress,
      TOKEN_IDS.ONE,
      TRANSFER_DATA
    );

    balance = await childTokenInstance.balanceOf(await wallet.getAddress());
    expect(balance).to.eq(1);

    // withdraw and deploy token on root chain (fxRoot)
    await expect(
      fxMintableERC721ChildTunnel.withdrawTo(
        expectedChildTokenAddress,
        await other.getAddress(),
        TOKEN_IDS.ONE,
        TRANSFER_DATA
      )
    )
      .to.emit(fxMintableERC721ChildTunnel, "FxWithdrawERC721")
      .withArgs(
        expectedRootTokenAddress,
        expectedChildTokenAddress,
        await other.getAddress(),
        TOKEN_IDS.ONE
      );

    expect(await childTokenInstance.balanceOf(await wallet.getAddress())).to.eq(
      0
    );
  });

  it("fxChild, deployToken fail - id is already used", async () => {
    const uniqueId = 0;
    await fxMintableERC721ChildTunnel.deployChildToken(
      uniqueId,
      "FxMintableRC721 Child Token",
      "FMCT"
    );
    await expect(
      fxMintableERC721ChildTunnel.deployChildToken(
        uniqueId,
        "FxMintableRC721 Child Token",
        "FMCT"
      )
    ).revertedWith("Create2: Failed on minimal deploy");
  });

  it("fxChild, mintToken fail - not mapped", async () => {
    await expect(
      fxMintableERC721ChildTunnel.mintToken(
        fxERC721.address,
        TOKEN_IDS.ONE,
        TRANSFER_DATA
      )
    ).to.be.revertedWith("FxMintableERC721ChildTunnel: NO_MAPPED_TOKEN");
  });
});
