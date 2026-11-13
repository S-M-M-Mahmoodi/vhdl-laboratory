----------------------------------------------------------------------------------
-- Project Name : adder
-- Module Name  : adder.vhd
-- Entity Name  : adder
-- Architecture : Behavioral
-- Target Lang  : VHDL-2008
-- Engineer     : Mahmoodi
-- Create Date  : 2026-11-10
-- Tool Versions: GHDL 6.0.0
----------------------------------------------------------------------------------

library ieee;
use ieee.std_logic_1164.all;
use ieee.numeric_std.all;

entity adder is
  port (
    A            : in    std_logic;
    B            : in    std_logic;
    Cin          : in    std_logic;
    S            : out   std_logic;
    Cout         : out   std_logic
    );
  end entity adder;

  architecture Behavioral of adder is
  begin

    S <= A xor B xor Cin;
    Cout <= (A and B) or (Cin and (A xor B));


  end architecture Behavioral;
