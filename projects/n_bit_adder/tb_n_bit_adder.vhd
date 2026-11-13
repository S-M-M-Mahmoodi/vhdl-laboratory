----------------------------------------------------------------------------------
-- Project Name : n_bit_adder
-- Testbench For: n_bit_adder
-- Module Name  : tb_n_bit_adder.vhd
-- Entity Name  : tb_n_bit_adder
-- Architecture : sim
-- Target Lang  : VHDL-2008
-- Engineer     : S.M.M.Mahmoodi
-- Description  : Testbench for parametric N-bit adder (N=8)
----------------------------------------------------------------------------------

library ieee;
use ieee.std_logic_1164.all;
use ieee.numeric_std.all;

entity tb_n_bit_adder is
end entity tb_n_bit_adder;

architecture sim of tb_n_bit_adder is
  constant N_BITS : integer := 8;

  signal a    : std_logic_vector(N_BITS - 1 downto 0) := (others => '0');
  signal b    : std_logic_vector(N_BITS - 1 downto 0) := (others => '0');
  signal cin  : std_logic := '0';
  signal sum  : std_logic_vector(N_BITS - 1 downto 0);
  signal cout : std_logic;

begin
  -- Instantiate DUT (8-bit adder)
  dut : entity work.n_bit_adder
    generic map (
      N => N_BITS
    )
    port map (
      a    => a,
      b    => b,
      cin  => cin,
      sum  => sum,
      cout => cout
    );

  -- Stimulus process (100 ns total duration)
  stim_proc : process
  begin
    -- Vector 1: 0 + 0 + 0 = 0, cout=0
    a   <= std_logic_vector(to_unsigned(0, N_BITS));
    b   <= std_logic_vector(to_unsigned(0, N_BITS));
    cin <= '0';
    wait for 20 ns;

    -- Vector 2: 15 + 10 + 0 = 25 (0x19), cout=0
    a   <= std_logic_vector(to_unsigned(15, N_BITS));
    b   <= std_logic_vector(to_unsigned(10, N_BITS));
    cin <= '0';
    wait for 20 ns;

    -- Vector 3: 15 + 10 + 1 = 26 (0x1A), cout=0
    cin <= '1';
    wait for 20 ns;

    -- Vector 4: 200 + 55 + 0 = 255 (0xFF), cout=0
    a   <= std_logic_vector(to_unsigned(200, N_BITS));
    b   <= std_logic_vector(to_unsigned(55, N_BITS));
    cin <= '0';
    wait for 20 ns;

    -- Vector 5: 255 + 1 + 0 = 256 -> sum=0x00, cout=1 (Overflow/Carry)
    a   <= std_logic_vector(to_unsigned(255, N_BITS));
    b   <= std_logic_vector(to_unsigned(1, N_BITS));
    cin <= '0';
    wait for 20 ns;

    wait; -- simulation complete
  end process stim_proc;

end architecture sim;
