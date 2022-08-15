import chai, { expect } from "chai";
import { Signer } from "ethers";
import { ethers } from "hardhat";
import { solidity } from "ethereum-waffle";
import { minimalProxyCreationCode } from "../shared/utilities";
import { getCreate2AddressFromSalt } from "../shared/utilities";
import { childFixture } from "../shared/fixtures";
import { FxERC1155 } from "../../types/FxERC1155";
import { FxMintableERC1155ChildTunnel } from "../../types/FxMintableERC1155ChildTunnel";
import { FxMintableERC1155RootTunnel } from "../../types/FxMintableERC1155RootTunnel";
import { rootFixture } from "../shared/fixtures";

import { ChildFixture, RootFixture } from "../shared/fixtures";
import { keccak256, solidityPack } from "ethers/lib/utils";
import { FxERC1155__factory } from "../../types/factories/FxERC1155__factory";

chai.use(solidity);

const TOKEN_IDS = { ONE: 1, TWO: 2 };
const TRANSFER_DATA = "0x";
const ZERO_ADDRESS = ethers.constants.AddressZero;
const URI = "https://";
const AMOUNT = 100;

describe("FxMintableERC1155Tunnel", () => {
  let wallet: Signer;
  let other: Signer;
  let fxERC1155: FxERC1155;
  let fxMintableERC1155ChildTunnel: FxMintableERC1155ChildTunnel;
  let fxMintableERC1155RootTunnel: FxMintableERC1155RootTunnel;

  beforeEach(async () => {
    const signers = await ethers.getSigners();
    wallet = signers[0];
    other = signers[1];
    const cFixture: ChildFixture = await childFixture(signers);
    fxERC1155 = cFixture.mintableERC1155Token;
    fxMintableERC1155ChildTunnel = cFixture.mintableErc1155;
    const rFixture: RootFixture = await rootFixture(signers, cFixture);
    fxMintableERC1155RootTunnel = rFixture.mintableErc1155;

    await fxERC1155.mint(
      await wallet.getAddress(),
      TOKEN_IDS.ONE,
      AMOUNT,
      TRANSFER_DATA
    );
  });

  it.only("fxChild, deployToken success", async () => {
    const uniqueId = 0;
    const childSalt = keccak256(solidityPack(["uint256"], [uniqueId]));
    const expectedChildTokenAddress = getCreate2AddressFromSalt(
      fxMintableERC1155ChildTunnel.address,
      childSalt,
      minimalProxyCreationCode(fxERC1155.address)
    );

    const rootSalt = keccak256(
      solidityPack(["address"], [expectedChildTokenAddress])
    );
    const expectedRootTokenAddress = getCreate2AddressFromSalt(
      fxMintableERC1155RootTunnel.address,
      rootSalt,
      minimalProxyCreationCode(fxERC1155.address)
    );

    let childTokenMap = await fxMintableERC1155ChildTunnel.rootToChildToken(
      expectedRootTokenAddress
    );
    let rootTokenMap = await fxMintableERC1155RootTunnel.rootToChildTokens(
      expectedRootTokenAddress
    );
    expect(childTokenMap).to.eq(rootTokenMap);
    expect(childTokenMap).to.eq(ZERO_ADDRESS);

    await expect(fxMintableERC1155ChildTunnel.deployChildToken(uniqueId, URI))
      .to.emit(fxMintableERC1155ChildTunnel, "TokenMapped")
      .withArgs(expectedRootTokenAddress, expectedChildTokenAddress);

    childTokenMap = await fxMintableERC1155ChildTunnel.rootToChildToken(
      expectedRootTokenAddress
    );

    expect(childTokenMap).to.eq(expectedChildTokenAddress);

    // root token map still unset
    rootTokenMap = await fxMintableERC1155RootTunnel.rootToChildTokens(
      expectedRootTokenAddress
    );
    expect(rootTokenMap).to.eq(ZERO_ADDRESS);

    const childTokenInstance = new FxERC1155__factory(wallet).attach(
      expectedChildTokenAddress
    );

    let balance = await childTokenInstance.balanceOf(
      await wallet.getAddress(),
      TOKEN_IDS.ONE
    );
    expect(balance).to.eq(0);

    await fxMintableERC1155ChildTunnel.mintToken(
      expectedChildTokenAddress,
      TOKEN_IDS.ONE,
      AMOUNT,
      TRANSFER_DATA
    );

    balance = await childTokenInstance.balanceOf(
      await wallet.getAddress(),
      TOKEN_IDS.ONE
    );
    expect(balance).to.eq(AMOUNT);

    // withdraw and deploy token on root chain (fxRoot)
    await expect(
      fxMintableERC1155ChildTunnel.withdrawTo(
        expectedChildTokenAddress,
        await other.getAddress(),
        TOKEN_IDS.ONE,
        AMOUNT,
        TRANSFER_DATA
      )
    )
      .to.emit(fxMintableERC1155ChildTunnel, "FxWithdrawERC1155")
      .withArgs(
        expectedRootTokenAddress,
        expectedChildTokenAddress,
        await other.getAddress(),
        TOKEN_IDS.ONE,
        AMOUNT
      );

    expect(
      await childTokenInstance.balanceOf(
        await wallet.getAddress(),
        TOKEN_IDS.ONE
      )
    ).to.eq(0);
  });

  it("fxChild, deployToken fail - id is already used", async () => {
    const uniqueId = 0;
    await fxMintableERC1155ChildTunnel.deployChildToken(uniqueId, URI);
    await expect(
      fxMintableERC1155ChildTunnel.deployChildToken(uniqueId, URI)
    ).revertedWith("Create2: Failed on minimal deploy");
  });

  it("fxChild, mintToken fail - not mapped", async () => {
    await expect(
      fxMintableERC1155ChildTunnel.mintToken(
        fxERC1155.address,
        TOKEN_IDS.ONE,
        AMOUNT,
        TRANSFER_DATA
      )
    ).to.be.revertedWith("FxMintableERC1155ChildTunnel: NO_MAPPED_TOKEN");
  });
});
