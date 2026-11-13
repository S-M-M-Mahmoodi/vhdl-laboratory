----------------------------------------------------------------------------------
-- Project Name : n_bit_adder
-- Module Name  : n_bit_adder.vhd
-- Entity Name  : n_bit_adder
-- Architecture : Behavioral
-- Target Lang  : VHDL-2008
-- Engineer     : S.M.M.Mahmoodi
-- Description  : Parametric N-bit adder with Carry-In and Carry-Out using numeric_std
----------------------------------------------------------------------------------

library ieee;
use ieee.std_logic_1164.all;
use ieee.numeric_std.all;

entity n_bit_adder is
  generic (
    N : integer := 8
  );
  port (
    a    : in  std_logic_vector(N - 1 downto 0);
    b    : in  std_logic_vector(N - 1 downto 0);
    cin  : in  std_logic := '0';
    sum  : out std_logic_vector(N - 1 downto 0);
    cout : out std_logic
  );
end entity n_bit_adder;

architecture Behavioral of n_bit_adder is
  signal ext_a   : unsigned(N downto 0);
  signal ext_b   : unsigned(N downto 0);
  signal ext_cin : unsigned(N downto 0);
  signal result  : unsigned(N downto 0);
begin
  ext_a <= resize(unsigned(a), N + 1);
  ext_b <= resize(unsigned(b), N + 1);
  ext_cin(N downto 1) <= (others => '0');
  ext_cin(0) <= cin;

  result <= ext_a + ext_b + ext_cin;

  sum  <= std_logic_vector(result(N - 1 downto 0));
  cout <= result(N);
end architecture Behavioral;
