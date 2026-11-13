----------------------------------------------------------------------------------
-- Project Name : or22
-- Module Name  : or22.vhd
-- Entity Name  : or22
-- Architecture : Behavioral
-- Target Lang  : VHDL-2008
-- Engineer     : Jalali
-- Create Date  : 2026-11-06
-- Tool Versions: GHDL 6.0.0
----------------------------------------------------------------------------------

library ieee;
use ieee.std_logic_1164.all;
use ieee.numeric_std.all;

entity or22 is
  port (
    A            : in    std_logic;
    B            : in    std_logic;
    Y            : out   std_logic
    );
  end entity or22;

  architecture Behavioral of or22 is
  begin

    y <= a or b;

  end architecture Behavioral;
