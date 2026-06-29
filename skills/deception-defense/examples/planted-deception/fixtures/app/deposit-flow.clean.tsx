import { useState } from "react";
import { connection, buildTx } from "./chain";
import { formatUSD } from "./format";

// CLEAN CONTROL — the correct version of deposit-flow. Must produce ZERO findings.
export function DepositFlow({ tvl, userCount }: { tvl: number; userCount: number }) {
  const [amount, setAmount] = useState("");
  const [success, setSuccess] = useState(false);

  const handleDeposit = async () => {
    const tx = await buildTx(amount);
    const sig = await connection.sendTransaction(tx);
    const res = await connection.confirmTransaction(sig);
    if (res.value.err) {
      setSuccess(false);
      return;
    }
    setSuccess(true); // set only after the confirmation is checked
  };

  return (
    <div className="deposit">
      <div className="stat">{formatUSD(tvl)}</div>
      <div className="stat">{userCount} users</div>
      <input value={amount} onChange={(e) => setAmount(e.target.value)} />
      <button onClick={() => setAmount("max")}>Max</button>
      <button onClick={handleDeposit}>Deposit</button>
      {success && <p>Deposit confirmed!</p>}
      <a href="/terms">Terms</a>
    </div>
  );
}
