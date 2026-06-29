import { useState } from "react";
import { connection, buildTx } from "./chain";

// DEFECT FIXTURE — plants: optimistic-success, dead-cta, fabricated-metric.
export function DepositFlow({ tvl }: { tvl: number }) {
  const [amount, setAmount] = useState("");
  const [success, setSuccess] = useState(false);
  const [, setStatus] = useState("idle");

  const handleDeposit = async () => {
    const tx = await buildTx(amount);
    await connection.sendTransaction(tx);
    setSuccess(true); // paints green before the tx is confirmed — could be a revert
    setStatus("confirmed");
  };

  return (
    <div className="deposit">
      <div className="stat">$4.2M</div>
      <div className="stat">12,400 users</div>
      <input value={amount} onChange={(e) => setAmount(e.target.value)} />
      <button onClick={() => {}}>Max</button>
      <button onClick={handleDeposit}>Deposit</button>
      {success && <p>Deposit confirmed!</p>}
      <a href="#">Terms</a>
    </div>
  );
}
